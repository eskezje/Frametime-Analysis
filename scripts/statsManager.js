// statsManager.js

/**
 * Retrieves the numeric value of a given metric from a row object.
 * Supports both standard metrics and PresentMon-style CSV formats.
 * @param {Object} row - One data row (key-value pairs).
 * @param {string} metric - Standard or PresentMon metric name
 * @returns {number|null} The numeric value, or null if unavailable.
 */
function getMetricValue(row, metric) {
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
 * @returns {Object} e.g. {max, min, avg, stdev, p1, p01, p001, low1, low01, low001}
 */
function calculateStatistics(arr) {
  if (!arr.length) {
    return {
      max: NaN, min: NaN, avg: NaN, stdev: NaN,
      p1: NaN, p01: NaN, p001: NaN,
      low1: NaN, low01: NaN, low001: NaN
    };
  }

  const sorted = [...arr].sort((a, b) => a - b);
  const maxVal = sorted[sorted.length - 1];
  const minVal = sorted[0];
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;
  const stdev = jStat.stdev(sorted);

  const p1 = calculatePercentile(sorted, 1);
  const p01 = calculatePercentile(sorted, 0.1);
  const p001 = calculatePercentile(sorted, 0.01);

  // "1% Low" = average of top 1% (worst frames) if bigger=bad
  let low1 = NaN, low01 = NaN, low001 = NaN;
  const c1 = Math.floor(sorted.length * 0.01);
  if (c1 > 0) {
    const slice1 = sorted.slice(-c1);
    low1 = slice1.reduce((a, b) => a + b, 0) / slice1.length;
  }

  const c01 = Math.floor(sorted.length * 0.001);
  if (c01 > 0) {
    const slice01 = sorted.slice(-c01);
    low01 = slice01.reduce((a, b) => a + b, 0) / slice01.length;
  }

  const c001 = Math.floor(sorted.length * 0.0001);
  if (c001 > 0) {
    const slice001 = sorted.slice(-c001);
    low001 = slice001.reduce((a, b) => a + b, 0) / slice001.length;
  }

  return {
    max: maxVal,
    min: minVal,
    avg,
    stdev,
    p1,
    p01,
    p001,
    low1,
    low01,
    low001
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
 * Analyzes frame pacing by looking at consecutive frametime differences.
 * The 'consistency' is 100% if every frame length is the same.
 * 
 * @param {number[]} frametimes 
 * @returns {{consistency:number, avgTransition:number, stdevTransition:number, badTransitions:Array}}
 */
function analyzeFramePacing(frametimes) {
  if (frametimes.length < 3) {
    return { consistency: 0, avgTransition: 0, stdevTransition: 0, badTransitions: [] };
  }

  // Consecutive frame deltas
  const diffs = [];
  for (let i = 1; i < frametimes.length; i++) {
    diffs.push(Math.abs(frametimes[i] - frametimes[i - 1]));
  }

  const avgDiff = jStat.mean(diffs);
  const stdevDiff = jStat.stdev(diffs);
  const consistency = 100 - Math.min(100, (stdevDiff / avgDiff) * 100);

  // Identify big jumps (2x average)
  const badTransitions = [];
  diffs.forEach((diff, i) => {
    if (diff > avgDiff * 2) {
      badTransitions.push({
        index: i + 1,  // i+1 since diffs[0] is between frame 0 and 1
        value: diff,
        ratio: diff / avgDiff
      });
    }
  });

  return {
    consistency,
    avgTransition: avgDiff,
    stdevTransition: stdevDiff,
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

  container.innerHTML = `
    <strong>Dataset:</strong> ${datasetName}<br/>
    <strong>Metric:</strong> ${metric}<br/>
    <ul>
      <li><strong>Max:</strong> ${stats.max?.toFixed(4)}</li>
      <li><strong>Avg:</strong> ${stats.avg?.toFixed(4)}</li>
      <li><strong>Min:</strong> ${stats.min?.toFixed(4)}</li>
      <li><strong>1%ile:</strong> ${stats.p1?.toFixed(4)}</li>
      <li><strong>0.1%ile:</strong> ${stats.p01?.toFixed(4)}</li>
      <li><strong>0.01%ile:</strong> ${stats.p001?.toFixed(4)}</li>
      <li><strong>1% Low:</strong> ${isNaN(stats.low1) ? 'N/A' : stats.low1.toFixed(4)}</li>
      <li><strong>0.1% Low:</strong> ${isNaN(stats.low01) ? 'N/A' : stats.low01.toFixed(4)}</li>
      <li><strong>0.01% Low:</strong> ${isNaN(stats.low001) ? 'N/A' : stats.low001.toFixed(4)}</li>
      <li><strong>STDEV:</strong> ${stats.stdev?.toFixed(4)}</li>
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
    const st = calculateStatistics(arr);

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
