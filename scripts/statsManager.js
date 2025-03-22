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

/**
 * Basic descriptive statistics for an array of numeric values.
 * Includes max, min, avg, stdev, plus some custom percentiles (p1, p01, etc.).
 * Also calculates "1% Low", "0.1% Low", etc. by averaging the worst frames.
 * @param {number[]} arr 
 * @param {string} metricName - Name of the metric being analyzed
 * @returns {Object} e.g. {max, min, avg, stdev, p1, p01, p001, low1, low01, low001}
 */
function calculateStatistics(arr, metricName = '') {
  if (!arr.length) {
    return {
      max: NaN, min: NaN, avg: NaN, stdev: NaN,
      p1: NaN, p01: NaN, p001: NaN,
      low1: NaN, low01: NaN, low001: NaN
    };
  }

  // Sort ascending once so we can reuse it
  const sorted = [...arr].sort((a, b) => a - b);
  const maxVal = sorted[sorted.length - 1];
  const minVal = sorted[0];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const stdev = jStat.stdev(sorted);

  // Percentiles (p1 = 1%, p01 = 0.1%, p001 = 0.01%)
  const p1 = calculatePercentile(sorted, 1);
  const p01 = calculatePercentile(sorted, 0.1);
  const p001 = calculatePercentile(sorted, 0.01);

  // Try to autodetect if it's FPS when metricName is empty by checking the value range
  // FPS values are typically in the range of 20-300, frametime values are typically 1-33ms
  let isFpsMetric = (metricName === 'FPS' || metricName.toLowerCase().includes('fps'));
  
  // Auto-detect FPS based on data if metric name is empty
  if (!metricName && avg > 30 && minVal > 20) {
    isFpsMetric = true;
  }

  // Number of frames in each slice (worst 1%, 0.1%, etc.)
  const c1 = Math.max(1, Math.ceil(sorted.length * 0.01));   // 1%
  const c01 = Math.max(1, Math.ceil(sorted.length * 0.001)); // 0.1%
  const c001 = Math.max(1, Math.ceil(sorted.length * 0.0001)); // 0.01%

  let low1 = NaN, low01 = NaN, low001 = NaN;

  if (isFpsMetric) {
    //
    // FPS: "Worst" frames have the LOWEST fps,
    // so we take the *beginning* of the ascending array.
    //
    if (c1 > 0) {
      low1 = sorted.slice(0, c1).reduce((s, v) => s + v, 0) / c1;
    }
    if (c01 > 0) {
      low01 = sorted.slice(0, c01).reduce((s, v) => s + v, 0) / c01;
    }
    if (c001 > 0) {
      low001 = sorted.slice(0, c001).reduce((s, v) => s + v, 0) / c001;
    }

  } else {
    //
    // FrameTime (or anything else where lower is better): "Worst" frames have the HIGHEST values,
    // so we reverse the ascending array and take from the top.
    //
    const descending = [...sorted].reverse();
    if (c1 > 0) {
      low1 = descending.slice(0, c1).reduce((s, v) => s + v, 0) / c1;
    }
    if (c01 > 0) {
      low01 = descending.slice(0, c01).reduce((s, v) => s + v, 0) / c01;
    }
    if (c001 > 0) {
      low001 = descending.slice(0, c001).reduce((s, v) => s + v, 0) / c001;
    }
  }

  return {
    max: maxVal,
    min: minVal,
    avg,
    stdev,
    p1,    // 1% percentile (single cutoff)
    p01,   // 0.1% percentile
    p001,  // 0.01% percentile
    low1,  // average of worst 1% of frames
    low01, // average of worst 0.1%
    low001 // average of worst 0.01%
  };
}

/**
 * Calculates the given percentile (like 1% or 0.1%) from a sorted array.
 * @param {number[]} sortedArr - Must be pre-sorted ascending.
 * @param {number} percentile - e.g. 1 => 1%, 0.1 => 0.1%
 * @returns {number} The percentile value, or NaN if array is empty.
 */
function calculatePercentile(sortedArr, percentile) {
  if (!sortedArr.length) return NaN;
  // percentile is from 0..100. e.g. percentile=1 => 1%
  const index = (percentile / 100) * (sortedArr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedArr[lower];
  }
  return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (index - lower);
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
  const avgDiff = jStat.mean(diffs);
  const stdevDiff = jStat.stdev(diffs);

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
 * for whichever single dataset is chosen in #statDatasetSelect,
 * and revealing/hiding columns based on toggled stats.
 */
function updateStatsTable() {
  const dsIndex = document.getElementById('statDatasetSelect').value;
  if (dsIndex === '') return;

  const ds = window.allDatasets[dsIndex];
  if (!ds) return;

  // Which metrics are toggled "active"?
  const selectedMetrics = Array.from(document.querySelectorAll('#statMetricsGroup .toggle-button.active'))
    .map(btn => btn.dataset.metric);

  // Which stats are toggled "active"?
  const selectedStats = Array.from(document.querySelectorAll('#statsTypeGroup .toggle-button.active'))
    .map(btn => btn.dataset.stat);

  const tbody = document.querySelector('#statsTable tbody');
  tbody.innerHTML = '';

  selectedMetrics.forEach(metric => {
    const arr = ds.rows.map(r => getMetricValue(r, metric)).filter(v => typeof v === 'number');
    
    // Pass metric name to ensure correct calculation of low percentiles
    const st = calculateStatistics(arr, metric);

    let rowHTML = `<tr><td>${metric}</td>`;

    // For each stat column, fill if user toggled it
    const colHeads = document.querySelectorAll('#statsTable thead th.stat-col');
    colHeads.forEach(th => {
      const statName = th.dataset.stat;
      if (selectedStats.includes(statName)) {
        let val = st[statName];
        if (!isNaN(val)) {
          val = val.toFixed(4);
        } else {
          val = 'N/A';
        }
        rowHTML += `<td>${val}</td>`;
      } else {
        // still create cell, but hidden
        rowHTML += `<td class="hidden"></td>`;
      }
    });

    rowHTML += '</tr>';
    tbody.insertAdjacentHTML('beforeend', rowHTML);
  });

  // Show/hide columns
  const cols = document.querySelectorAll('#statsTable thead th.stat-col');
  cols.forEach(col => {
    const statName = col.dataset.stat;
    const idx = Array.from(col.parentNode.children).indexOf(col);

    if (selectedStats.includes(statName)) {
      col.classList.remove('hidden');
      document.querySelectorAll('#statsTable tbody tr').forEach(tr => {
        tr.children[idx]?.classList.remove('hidden');
      });
    } else {
      col.classList.add('hidden');
      document.querySelectorAll('#statsTable tbody tr').forEach(tr => {
        tr.children[idx]?.classList.add('hidden');
      });
    }
  });

  // Example: highlight cells on hover
  document.querySelectorAll('#statsTable tbody td').forEach(cell => {
    cell.addEventListener('mouseenter', () => cell.classList.add('highlight'));
    cell.addEventListener('mouseleave', () => cell.classList.remove('highlight'));
  });
}

/**
 * Optionally provides a separate function to visualize the calculated stats in a chart,
 * e.g. #statsChart, if you want to show a bar chart of e.g. "Avg" for each metric.
 */
function visualizeStatistics() {
  const container = document.getElementById('statsVisualizationContainer');
  if (!container) return;

  container.classList.remove('hidden');
  // e.g. you could create a bar chart in #statsChart showing each metric’s values
  // Implementation depends on your design
  console.log("Visualize stats not yet implemented. Add your chart code here if desired.");
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
