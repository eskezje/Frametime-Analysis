// statsManager.js

/**
 * Retrieves the numeric value of a given metric from a row object.
 * Supports both standard metrics and PresentMon-style CSV formats.
 * @param {Object} row - One data row (key-value pairs).
 * @param {string} metric - Standard or PresentMon metric name
 * @returns {number|null} The numeric value, or null if unavailable.
 */
function getMetricValue(row, metric) {
  // Handle FrameTime specially - can come from different sources
  if (metric === 'FrameTime') {
    // Try standard format first
    if (typeof row['FrameTime'] === 'number') {
      return row['FrameTime'];
    }
    // Try PresentMon format (case insensitive)
    const mbpKey = Object.keys(row).find(key => 
      key.toLowerCase() === 'msbetweenpresents');
    
    if (mbpKey && typeof row[mbpKey] === 'number') {
      return row[mbpKey]; // Return MsBetweenPresents as FrameTime
    }
    return null;
  }
  
  // Handle FPS calculation specially as it can be derived from different frametime metrics
  if (metric === 'FPS') {
    // Try standard format first
    if (typeof row['FrameTime'] === 'number' && row['FrameTime'] > 0) {
      return 1000.0 / row['FrameTime'];
    }
    // Try PresentMon format (case insensitive)
    else {
      // Check for MsBetweenPresents or msBetweenPresents
      const mbpKey = Object.keys(row).find(key => 
        key.toLowerCase() === 'msbetweenpresents');
      
      if (mbpKey && typeof row[mbpKey] === 'number' && row[mbpKey] > 0) {
        return 1000.0 / row[mbpKey];
      }
    }
    return null;
  }
  
  // For other metrics, try case-insensitive match
  if (typeof row[metric] === 'number') {
    return row[metric];
  }
  
  // Try case-insensitive matching
  const matchingKey = Object.keys(row).find(key => 
    key.toLowerCase() === metric.toLowerCase());
  
  return (matchingKey && typeof row[matchingKey] === 'number') ? row[matchingKey] : null;
}

function percentileNearestRank(sortedAsc, p) {
  if (!sortedAsc.length) return NaN;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;   // 0‑based
  return sortedAsc[Math.max(0, Math.min(rank, sortedAsc.length - 1))];
}

function calculateStatistics(arr, metricName = '') {
  if (!arr.length) {
    return {
      max: NaN, min: NaN, avg: NaN, stdev: NaN,
      p1: NaN, p01: NaN, p001: NaN,
      low1: NaN, low01: NaN, low001: NaN
    };
  }

  /* -------- basic aggregates --------------------------------------- */
  const sorted = [...arr].sort((a, b) => a - b);  // ascending
  const n      = sorted.length;
  const maxVal = sorted[n - 1];
  const minVal = sorted[0];
  const sum    = sorted.reduce((a, b) => a + b, 0);

  const avg = (metricName.toUpperCase() === 'FPS')
      ? n / sorted.reduce((s, v) => s + 1 / v, 0)   // harmonic mean
      : sum / n;

  const stdev = (typeof jStat?.stdev === 'function')
      ? jStat.stdev(sorted, true)
      : Math.sqrt(sorted.reduce((s, v) => s + (v - avg) ** 2, 0) / (n - 1));

  /* -------- determine FPS vs Frame‑time ---------------------------- */
  let isFpsMetric =
        metricName.toUpperCase() === 'FPS' ||
        metricName.toLowerCase().includes('fps');
  if (!metricName && avg > 30 && minVal > 20) isFpsMetric = true;

  /* -------- percentiles (single‑frame cut‑off) --------------------- */
  const p1   = percentileNearestRank(sorted,  isFpsMetric ? 1     : 99);
  const p01  = percentileNearestRank(sorted,  isFpsMetric ? 0.1   : 99.9);
  const p001 = percentileNearestRank(sorted,  isFpsMetric ? 0.01  : 99.99);

  /* -------- “X % Low” (average of worst frames) -------------------- */
  const c1   = Math.max(1, Math.ceil(n * 0.01));     // 1 %
  const c01  = Math.max(1, Math.ceil(n * 0.001));    // 0.1 %
  const c001 = Math.max(1, Math.ceil(n * 0.0001));   // 0.01 %

  let low1, low01, low001;

  if (isFpsMetric) {
    // worst FPS = smallest values (array head)
    low1   = sorted.slice(0, c1).  reduce((s, v) => s + v, 0) / c1;
    low01  = sorted.slice(0, c01). reduce((s, v) => s + v, 0) / c01;
    low001 = sorted.slice(0, c001).reduce((s, v) => s + v, 0) / c001;
  } else {
    // worst frame‑times = largest values (array tail)
    const desc = [...sorted].reverse();
    low1   = desc.slice(0, c1).  reduce((s, v) => s + v, 0) / c1;
    low01  = desc.slice(0, c01). reduce((s, v) => s + v, 0) / c01;
    low001 = desc.slice(0, c001).reduce((s, v) => s + v, 0) / c001;
  }

  /* -------- return -------------------------------------------------- */
  return {
    max: maxVal,
    min: minVal,
    avg,
    stdev,
    p1,  p01,  p001,
    low1, low01, low001
  };
}



function calculatePercentile(sortedArr, percentile) {
  // percentile expressed as 1 → 1 %, 0.1 → 0.1 %
  if (!sortedArr.length) return NaN;

  const idx = (percentile / 100) * (sortedArr.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.min(sortedArr.length - 1, Math.ceil(idx));

  if (lower === upper) return sortedArr[lower];

  const w = idx - lower;               // linear interpolation weight
  return sortedArr[lower] * (1 - w) + sortedArr[upper] * w;
}

/**
 * Analyzes stuttering frames, defining a stutter as a frame 1.5x longer than median.
 * Returns the total stutter count, % of total, and avg severity beyond threshold.
 * @param {number[]} frametimes
 * @returns {{count:number, percentage:number, severity:number}}
 */
function analyzeStuttering(frametimes) {
  if (!frametimes.length) {
    return { count: 0, percentage: 0, severity: 0 };
  }
  const sorted = [...frametimes].sort((a, b) => a - b);
  const median = calculatePercentile(sorted, 50);
  const stutterThreshold = median * 1.5;

  let stutterCount = 0;
  let totalSeverity = 0;

  frametimes.forEach(ft => {
    if (ft > stutterThreshold) {
      stutterCount++;
      totalSeverity += (ft - stutterThreshold) / median;
    }
  });

  return {
    count: stutterCount,
    percentage: (stutterCount / frametimes.length) * 100,
    severity: stutterCount > 0 ? (totalSeverity / stutterCount) : 0
  };
}

/**
 * Analyzes frame pacing in a general, robust way using median-based statistics.
 * Works reliably across any framerate (30, 60, 144, 250, etc.) without bias.
 * 
 * @param {number[]} frametimes - Array of per-frame durations (ms)
 * @returns {{consistency:number, medianFrametime:number, madFrametime:number, 
 *            medianTransition:number, madTransition:number, badTransitions:Array}}
 */
function analyzeFramePacing(frametimes) {
  if (frametimes.length < 3) {
    return {
      consistency: 0,
      medianFrametime: 0,
      madFrametime: 0,
      medianTransition: 0, 
      madTransition: 0,
      stdevTransition: 0, // keep for backward compatibility
      avgTransition: 0,   // keep for backward compatibility
      badTransitions: []
    };
  }

  // 1. Calculate median frametime (robust measure of "typical" performance)
  const sorted = [...frametimes].sort((a, b) => a - b);
  const medianFT = calculatePercentile(sorted, 50);

  // 2. Compute relative deviations: (|t - median| / median)
  const relDeviations = frametimes.map(t => Math.abs(t - medianFT) / medianFT);

  // 3. Get the median of these relative deviations
  const medianRelDev = calculatePercentile([...relDeviations].sort((a, b) => a - b), 50);

  // 4. Calculate MAD of the raw frametimes
  const absDeviationsFromMedian = frametimes.map(t => Math.abs(t - medianFT));
  const sortedDevs = [...absDeviationsFromMedian].sort((a, b) => a - b);
  const madFT = calculatePercentile(sortedDevs, 50);

  // 5. Compute consecutive diffs, then median + MAD for transitions
  const diffs = [];
  for (let i = 1; i < frametimes.length; i++) {
    diffs.push(Math.abs(frametimes[i] - frametimes[i - 1]));
  }
  
  const sortedDiffs = [...diffs].sort((a, b) => a - b);
  const medianDiff = calculatePercentile(sortedDiffs, 50);
  
  const absDeviationsDiff = diffs.map(d => Math.abs(d - medianDiff));
  const sortedDiffDevs = [...absDeviationsDiff].sort((a, b) => a - b);
  const madDiff = calculatePercentile(sortedDiffDevs, 50);

  // Also calculate standard stats for backward compatibility
  const avgDiff = (typeof jStat !== 'undefined' && typeof jStat.mean === 'function')
    ? jStat.mean(diffs)
    : diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const stdevDiff = (typeof jStat !== 'undefined' && typeof jStat.stdev === 'function')
    ? jStat.stdev(diffs, true)
    : Math.sqrt(diffs.reduce((s, v) => s + (v - avgDiff) ** 2, 0) / (diffs.length - 1));

  // 6. Define consistency as a function of medianRelDev
  // Tuned with alpha parameter for sensitivity
  const alpha = 3.0; 
  let consistency = 100 * (1 - Math.min(1, alpha * medianRelDev));
  consistency = Math.max(0, Math.min(100, consistency)); // clamp to [0, 100]

  // 7. Identify large transitions if diff is > K * medianDiff
  const K = 2.5;
  const badTransitions = [];
  diffs.forEach((diff, i) => {
    if (diff > K * medianDiff) {
      badTransitions.push({
        index: i + 1,  // i+1 -> transition from frame i to frame i+1
        value: diff,
        ratio: diff / medianDiff  // keep same property name for compatibility
      });
    }
  });

  return {
    consistency: Math.round(consistency * 100) / 100, // round to 2 decimal places
    medianFrametime: medianFT,
    madFrametime: madFT,
    medianTransition: medianDiff,
    madTransition: madDiff,
    avgTransition: avgDiff,      // keep for backward compatibility
    stdevTransition: stdevDiff,  // keep for backward compatibility
    badTransitions
  };
}

/**
 * Displays stats for the last added dataset in the #visualStats panel,
 * including stuttering info if metric is FrameTime.
 * @param {Object} stats - Return of calculateStatistics().
 * @param {string} metric 
 * @param {string} datasetName
 */
function showVisualStats(stats, metric, datasetName) {
  const container = document.getElementById('visualStats');
  if (!container) return;

  // Determine whether higher or lower values are better for this metric
  const isFpsMetric = metric.toLowerCase().includes('fps');
  
  const betterLabel = isFpsMetric ? 'higher' : 'lower';
  const worseLabel = isFpsMetric ? 'lower' : 'higher';

  // Create more accurate explanations for the "X% Low" metrics
  const low1Explanation = isFpsMetric 
    ? "avg of worst-performing frames (lowest 1%)" 
    : "avg of worst-performing frames (highest 1%)";
  const low01Explanation = isFpsMetric 
    ? "avg of worst-performing frames (lowest 0.1%)"
    : "avg of worst-performing frames (highest 0.1%)";
  const low001Explanation = isFpsMetric 
    ? "avg of worst-performing frames (lowest 0.01%)"
    : "avg of worst-performing frames (highest 0.01%)";

  let stutterInfo = '';
  if (metric === 'FrameTime') {
    const dsObj = window.allDatasets.find(ds => ds.name === datasetName);
    if (dsObj) {
      const frametimes = dsObj.rows.map(r => getMetricValue(r, 'FrameTime')).filter(v => v !== null);
      const st = analyzeStuttering(frametimes);
      stutterInfo = `
        <li><strong>Stutter Frames:</strong> ${st.count} (${st.percentage.toFixed(2)}% of total)</li>
        <li><strong>Avg Stutter Severity:</strong> ${st.severity.toFixed(4)}× threshold</li>
      `;
    }
  }

  // Add a header that explains what's better for this metric
  const metricExplanation = `<p class="metric-explanation">${isFpsMetric ? 'Higher values are better' : 'Lower values are better'} for ${metric}</p>`;

  container.innerHTML = `
    <strong>Dataset:</strong> ${datasetName}<br/>
    <strong>Metric:</strong> ${metric}<br/>
    ${metricExplanation}
    <ul>
      <li><strong>Max:</strong> ${stats.max?.toFixed(4)} <span class="value-quality">(${isFpsMetric ? 'best' : 'worst'} value)</span></li>
      <li><strong>Avg:</strong> ${stats.avg?.toFixed(4)}</li>
      <li><strong>Min:</strong> ${stats.min?.toFixed(4)} <span class="value-quality">(${isFpsMetric ? 'worst' : 'best'} value)</span></li>
      <li><strong>1%ile:</strong> ${stats.p1?.toFixed(4)} <span class="value-note">(${isFpsMetric ? 'low' : 'high'} outlier threshold)</span></li>
      <li><strong>0.1%ile:</strong> ${stats.p01?.toFixed(4)}</li>
      <li><strong>0.01%ile:</strong> ${stats.p001?.toFixed(4)}</li>
      <li><strong>1% Low:</strong> ${isNaN(stats.low1) ? 'N/A' : stats.low1.toFixed(4)} <span class="value-note">(${low1Explanation})</span></li>
      <li><strong>0.1% Low:</strong> ${isNaN(stats.low01) ? 'N/A' : stats.low01.toFixed(4)} <span class="value-note">(${low01Explanation})</span></li>
      <li><strong>0.01% Low:</strong> ${isNaN(stats.low001) ? 'N/A' : stats.low001.toFixed(4)} <span class="value-note">(${low001Explanation})</span></li>
      <li><strong>STDEV:</strong> ${stats.stdev?.toFixed(4)} <span class="value-note">${isFpsMetric ? 'Higher means more variable FPS' : 'Higher means more variable frame times'}</span></li>
      ${stutterInfo}
    </ul>
  `;
}

/**
 * Updates the Statistics table (#statsTable) by computing stats for each selected metric,
 * for all selected datasets in the statDatasetSelect dropdown,
 * and revealing/hiding columns based on toggled stats.
 */
function updateStatsTable() {
  const statsContent = document.getElementById('statistics');
  const statDatasetSelect = document.getElementById('statDatasetSelect');
  const selectedDatasetIndices = Array.from(statDatasetSelect.selectedOptions).map(opt => parseInt(opt.value));
  
  // Add or remove the empty class based on whether datasets are selected
  if (!selectedDatasetIndices.length) {
    statsContent.classList.add('empty-stats');
    return;
  } else {
    statsContent.classList.remove('empty-stats');
  }

  // Get the selected datasets
  const selectedDatasets = selectedDatasetIndices.map(idx => window.allDatasets[idx]).filter(Boolean);
  if (!selectedDatasets.length) return;

  // Which metrics are toggled "active"?
  const selectedMetrics = Array.from(document.querySelectorAll('#statMetricsGroup .toggle-button.active'))
    .map(btn => btn.dataset.metric);
  
  if (!selectedMetrics.length) return;

  // Which stats are toggled "active"?
  const selectedStats = Array.from(document.querySelectorAll('#statsTypeGroup .toggle-button.active'))
    .map(btn => btn.dataset.stat);
  
  if (!selectedStats.length) return;

  // Create the table header with statistic types
  const statsTable = document.getElementById('statsTable');
  const thead = statsTable.querySelector('thead');
  const tbody = statsTable.querySelector('tbody');

  // Clear existing table content
  thead.innerHTML = '';
  tbody.innerHTML = '';

  // Create the header row with stat names
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = '<th>Dataset</th>';

  // Add each stat as a column header
  selectedStats.forEach(stat => {
    headerRow.innerHTML += `<th>${getStatDisplayName(stat)}</th>`;
  });

  thead.appendChild(headerRow);

  // Process each metric separately
  selectedMetrics.forEach(metric => {
    // Add a metric header row
    const metricHeaderRow = document.createElement('tr');
    metricHeaderRow.className = 'stats-metric-header';
    metricHeaderRow.innerHTML = `<th colspan="${selectedStats.length + 1}">${metric}</th>`;
    tbody.appendChild(metricHeaderRow);
    
    // Calculate statistics for each dataset for this metric
    const datasetStats = selectedDatasets.map(dataset => {
      const values = dataset.rows
        .map(r => getMetricValue(r, metric))
        .filter(v => typeof v === 'number');
      
      return {
        name: dataset.name,
        stats: calculateStatistics(values, metric)
      };
    });

    // Determine if higher values are better for this metric
    const isFpsMetric = metric.toLowerCase().includes('fps');
    
    // Create a row for each dataset
    datasetStats.forEach(dsStats => {
      const datasetRow = document.createElement('tr');
      
      // Add dataset name cell
      const nameCell = document.createElement('td');
      nameCell.textContent = dsStats.name;
      nameCell.className = 'dataset-name-cell';
      datasetRow.appendChild(nameCell);
      
      // For each selected stat type, add a cell
      selectedStats.forEach(stat => {
        const value = dsStats.stats[stat];
        const cell = document.createElement('td');
        
        if (!isNaN(value)) {
          // Format the value
          cell.textContent = value.toFixed(4);
          
          // Compare values across datasets if there are multiple
          if (datasetStats.length > 1) {
            // Get all values for this stat across datasets
            const allValues = datasetStats
              .map(ds => ds.stats[stat])
              .filter(v => !isNaN(v));

            // Determine if this value is best or worst
            const isBest = isFpsMetric ? 
              (stat === 'stdev' ? value === Math.min(...allValues) : value === Math.max(...allValues)) :
              (stat === 'stdev' ? value === Math.min(...allValues) : value === Math.min(...allValues));
              
            const isWorst = isFpsMetric ? 
              (stat === 'stdev' ? value === Math.max(...allValues) : value === Math.min(...allValues)) :
              (stat === 'stdev' ? value === Math.max(...allValues) : value === Math.max(...allValues));
              
            if (isBest) cell.classList.add('dataset-better-value');
            else if (isWorst) cell.classList.add('dataset-worse-value');
          }
        } else {
          cell.textContent = 'N/A';
        }
        
        datasetRow.appendChild(cell);
      });
      
      tbody.appendChild(datasetRow);
    });
    
    // Add an empty row after each metric group for better readability
    if (selectedMetrics.length > 1) {
      const spacerRow = document.createElement('tr');
      spacerRow.className = 'metric-spacer-row';
      spacerRow.innerHTML = `<td colspan="${selectedStats.length + 1}"></td>`;
      tbody.appendChild(spacerRow);
    }
  });
}

// Chart.js instance for statistics visualization
let statsChart = null;

/**
 * Visualizes selected statistics in a simple bar chart.
 * Uses the first enabled statistic across chosen metrics and datasets.
 */
function visualizeStatistics() {
  const container = document.getElementById('statsVisualizationContainer');
  const canvas = document.getElementById('statsChart');
  if (!container || !canvas) return;

  const statDatasetSelect = document.getElementById('statDatasetSelect');
  const datasetIndices = Array.from(statDatasetSelect.selectedOptions).map(opt => parseInt(opt.value));
  if (!datasetIndices.length) {
    window.notify?.('Select datasets to visualize statistics', 'warning');
    return;
  }

  const metrics = Array.from(document.querySelectorAll('#statMetricsGroup .toggle-button.active')).map(btn => btn.dataset.metric);
  const stats = Array.from(document.querySelectorAll('#statsTypeGroup .toggle-button.active')).map(btn => btn.dataset.stat);

  if (!metrics.length || !stats.length) {
    window.notify?.('Select metrics and stats', 'warning');
    return;
  }

  const statKey = stats[0];
  const chartLabels = metrics.slice();
  const chartDatasets = datasetIndices.map((idx, i) => {
    const ds = window.allDatasets[idx];
    const data = metrics.map(metric => {
      const values = ds.rows.map(r => getMetricValue(r, metric)).filter(v => typeof v === 'number');
      const statObj = calculateStatistics(values, metric);
      return statObj[statKey];
    });
    const color = typeof randomColor === 'function' ? randomColor() : `hsl(${(i * 70) % 360},70%,50%)`;
    return { label: `${ds.name} (${statKey})`, data, backgroundColor: color };
  });

  container.classList.remove('hidden');

  if (statsChart) statsChart.destroy();

  statsChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: chartLabels,
      datasets: chartDatasets
    },
    options: {
      responsive: true,
      scales: {
        x: { title: { display: true, text: 'Metric' } },
        y: { title: { display: true, text: getStatDisplayName(statKey) } }
      }
    }
  });
}

/**
 * Returns a display name for a statistic key
 * @param {string} stat - Statistic key (e.g., 'avg', 'p1', 'stdev')
 * @returns {string} - Human readable name
 */
function getStatDisplayName(stat) {
  const displayNames = {
    'max': 'Maximum',
    'min': 'Minimum',
    'avg': 'Average',
    'stdev': 'Std Deviation',
    'p1': '1% Percentile',
    'p01': '0.1% Percentile',
    'p001': '0.01% Percentile',
    'low1': '1% Low',
    'low01': '0.1% Low',
    'low001': '0.01% Low'
  };
  
  return displayNames[stat] || stat;
}

// Expose these to the global scope:
window.getMetricValue = getMetricValue;
window.calculateStatistics = calculateStatistics;
window.calculatePercentile = calculatePercentile;
window.analyzeStuttering = analyzeStuttering;
window.analyzeFramePacing = analyzeFramePacing;
window.showVisualStats = showVisualStats;
window.updateStatsTable = updateStatsTable;
window.visualizeStatistics = visualizeStatistics;
window.getStatDisplayName = getStatDisplayName;
