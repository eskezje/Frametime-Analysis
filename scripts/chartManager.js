// chartManager.js

// We'll store the Chart.js instance & chart-specific data arrays
window.mainChart = null;
window.chartDatasets = [];

/**
 * Builds a histogram from an array of numeric data.
 * @param {number[]} data
 * @returns {{labels: string[], counts: number[]}}
 */
function buildHistogram(data) {
  if (!data.length) {
    return { labels: [], counts: [] };
  }

  const minVal = Math.min(...data);
  const maxVal = Math.max(...data);

  // Handle case where all values are identical
  if (minVal === maxVal) {
    return { labels: [minVal.toString()], counts: [data.length] };
  }

  // A simple approach: #bins = sqrt(n) but capped at 50
  const binCount = Math.max(1, Math.min(50, Math.ceil(Math.sqrt(data.length))));
  const binWidth = (maxVal - minVal) / binCount;

  const counts = Array(binCount).fill(0);
  data.forEach(val => {
    const idx = Math.min(
      binCount - 1,
      Math.floor((val - minVal) / binWidth)
    );
    counts[idx]++;
  });

  // Build array of bin range labels, e.g. "1.00-2.34"
  const labels = [];
  for (let i = 0; i < binCount; i++) {
    const rangeStart = (minVal + i * binWidth).toFixed(2);
    const rangeEnd = (minVal + (i + 1) * binWidth).toFixed(2);
    labels.push(`${rangeStart}-${rangeEnd}`);
  }
  return { labels, counts };
}

/**
 * Builds Q-Q plot data points, comparing sample quantiles vs. theoretical normal quantiles.
 * @param {number[]} data
 * @returns {{x: number, y: number}[]}
 */
function buildQQPlot(data) {
  // Sort ascending
  const sorted = [...data].sort((a, b) => a - b);
  const n = sorted.length;
  const qqPoints = [];

  for (let i = 0; i < n; i++) {
    // Blom's method for percentile
    const p = (i + 0.5) / n;
    // Theoretical z-score for that percentile (mean=0, stdev=1)
    const z = jStat.normal.inv(p, 0, 1);

    qqPoints.push({
      x: z,        // Theoretical quantile
      y: sorted[i] // Sample quantile
    });
  }
  return qqPoints;
}

/**
 * Renders (or re‑renders) the Chart.js chart based on the current chartDatasets array.
 * @param {string} chartType - 'line' | 'scatter' | 'bar' | 'histogram' | 'qqplot' | 'violin'
 */
function renderChart(chartType) {
  const canvas = document.getElementById('mainChart');
  const chartContainer = document.getElementById('chartContainer');
  if (!canvas || !chartContainer) {
    console.warn("Chart elements not found in HTML.");
    return;
  }

  const ctx = canvas.getContext('2d');
  if (window.mainChart) {
    window.mainChart.destroy();
  }
  if (!Array.isArray(window.chartDatasets) || window.chartDatasets.length === 0) {
    chartContainer.classList.add('empty');
    console.log("No datasets to render.");
    return;
  }
  chartContainer.classList.remove('empty');

  // determine controller type & axes
  let ctrlType = 'line';
  const scales = {};
  if (chartType === 'histogram') {
    ctrlType = 'bar';
    scales.x = { type: 'category', title: { display: true, text: 'Bin Range' } };
    scales.y = { title: { display: true, text: 'Count' } };
  } else if (chartType === 'qqplot') {
    ctrlType = 'scatter';
    scales.x = { type: 'linear', title: { display: true, text: 'Theoretical Quantiles' } };
    scales.y = { type: 'linear', title: { display: true, text: 'Sample Quantiles' } };
  } else if (chartType === 'scatter') {
    ctrlType = 'scatter';
    scales.x = { type: 'linear', title: { display: true, text: 'Sample # / Frame #' } };
    scales.y = { type: 'linear', title: { display: true, text: 'Value' } };
  } else if (chartType === 'violin') {
    ctrlType = 'violin';
    scales.x = { type: 'category', title: { display: true, text: 'Dataset' } };
    scales.y = { type: 'linear', title: { display: true, text: 'Value' } };
  } else {
    scales.x = { type: 'linear', title: { display: true, text: 'Sample # / Frame #' } };
    scales.y = { type: 'linear', title: { display: true, text: 'Value' } };
  }

  // build config
  const cfg = {
    type: ctrlType,
    data: {
      datasets: window.chartDatasets.slice()
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales,
      plugins: {
        tooltip: {
          callbacks: {
            label(ctx) {
              if (ctx.dataset.type === 'violin') {
                const vals = ctx.dataset.data[ctx.dataIndex];
                const [q1, m, q3] = jStat.quantiles(vals, [0.25, 0.5, 0.75]);
                return [
                  `N = ${vals.length}`,
                  `Q1 = ${q1.toFixed(2)}`,
                  `Median = ${m.toFixed(2)}`,
                  `Q3 = ${q3.toFixed(2)}`
                ];
              }
              return `${ctx.dataset.label}: ${ctx.formattedValue}`;
            }
          }
        },
        legend: { display: true },
        zoom: {
          pan:  { enabled: true, mode: 'xy' },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            drag: {
              enabled: true,
              backgroundColor: 'rgba(52,152,219,0.2)',
              borderColor:     'rgba(52,152,219,0.5)',
              borderWidth:     1
            },
            mode: 'xy'
          }
        }
      }
    }
  };

  // if violin, we already have 2 datasets: violin & boxplot
  // axis labels come from chartLabels
  if (chartType === 'violin') {
    cfg.data.labels = window.chartLabels.slice();
    // we let each dataset carry its own .type and .order
  }

  window.mainChart = new Chart(ctx, cfg);
  console.log(`Chart rendered (${chartType}) with ${window.chartDatasets.length} dataset(s).`);
}


/**
 * Clears the current chart (removes all datasets from chartDatasets).
 */
function clearChart() {
  window.chartDatasets.length = 0;
  if (window.mainChart) {
    window.mainChart.destroy();
    window.mainChart = null;
  }
  
  // Show the empty state
  const chartContainer = document.getElementById('chartContainer');
  if (chartContainer) {
    chartContainer.classList.add('empty');
  }
  
  document.getElementById('datasetOrderList').innerHTML = '';
  console.log("Chart cleared");
}

// helper to convert "#RRGGBB" → "rgba(r,g,b,a)"
function hexToRgba(hex, alpha) {
  const bigint = parseInt(hex.replace('#',''), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8)  & 255;
  const b = bigint & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Builds chartDatasets (and for violin, chartLabels) then calls renderChart().
 */
function addToChart() {
  const select = document.getElementById('datasetSelect');
  const indices = Array.from(select.selectedOptions).map(o => +o.value);
  if (indices.length === 0) {
    console.error("No datasets selected.");
    return;
  }

  const metric    = document.getElementById('metricSelect').value;
  const chartType = document.getElementById('chartTypeSelect').value;
  const hexColor  = document.getElementById('colorSelect').value;

  // clear out any previous
  window.chartDatasets = [];

  // ---- VIOLIN + BOXPLOT COMBO ----
if (chartType === 'violin') {
  const labels = indices.map(i => allDatasets[i].name);
  const groups = indices.map(i =>
    allDatasets[i].rows
      .map(r => getMetricValue(r, metric))
      .filter(v => v != null)
  );

  window.chartLabels = labels.slice();

  // violin fill derived from user color:
  const violinFill = hexToRgba(hexColor, 0.3);
  const borderClr  = hexToRgba(hexColor, 1.0);

  // gray for boxplot
  const grayBorder = 'rgba(80,80,80,1)';
  const grayFill   = 'rgba(80,80,80,0.4)';

  const violinDs = {
    label:           `${metric} Density`,
    type:            'violin',
    data:            groups,
    backgroundColor: labels.map(() => violinFill),
    borderColor:     labels.map(() => borderClr),
    borderWidth:     1,
    order:           2
  };

  const boxDs = {
    label:           `${metric} Quartiles`,
    type:            'boxplot',
    data:            groups,
    backgroundColor: labels.map(() => grayFill),
    borderColor:     labels.map(() => grayBorder),
    borderWidth:     2,
    order:           1,
    barPercentage:   0.05,
    categoryPercentage: 1.0
  };

  window.chartDatasets = [violinDs, boxDs];
  renderChart('violin');
  updateDatasetOrder();
  clearChartBtn.disabled = false;
  return;
}


  // ---- ALL OTHER CHART TYPES ----
  indices.forEach(idx => {
    const ds = window.allDatasets[idx];
    const vals = ds.rows
      .map(r => getMetricValue(r, metric))
      .filter(v => v != null);
    if (!vals.length) return;

    let cfg;
    // line & scatter
    if (chartType === 'line' || chartType === 'scatter') {
      cfg = {
        label:           `${ds.name} - ${metric}`,
        data:            vals.map((v,i) => ({ x: i+1, y: v })),
        borderColor:     hexColor,
        backgroundColor: hexColor,
        pointRadius:     chartType === 'scatter' ? 3 : 1,
        showLine:        chartType === 'line',
        fill:            chartType === 'line'
      };
    }
    // histogram
    else if (chartType === 'histogram') {
      const bins = buildHistogram(vals);
      cfg = {
        label:           `${ds.name} - ${metric}`,
        data:            bins.counts.map((c,i) => ({ x: bins.labels[i], y: c })),
        type:            'bar',
        backgroundColor: hexColor
      };
    }
    // QQ‑plot
    else if (chartType === 'qqplot') {
      const qq    = buildQQPlot(vals);
      const mean  = jStat.mean(vals), std = jStat.stdev(vals);
      const zs    = qq.map(p => p.x);
      const linePts = [
        { x: Math.min(...zs), y: mean + std * Math.min(...zs) },
        { x: Math.max(...zs), y: mean + std * Math.max(...zs) }
      ];
      // data points
      window.chartDatasets.push({
        label:           `${ds.name} - ${metric} (Data)`,
        data:            qq,
        borderColor:     hexColor,
        backgroundColor: hexColor,
        pointRadius:     3,
        showLine:        false
      });
      // ref line
      cfg = {
        label:           `${ds.name} - ${metric} (Ref Line)`,
        data:            linePts,
        borderColor:     '#f00',
        backgroundColor: '#f00',
        pointRadius:     0,
        borderWidth:     2,
        showLine:        true
      };
    }

    if (cfg) {
      window.chartDatasets.push(cfg);
    }
  });

  renderChart(chartType);
  updateDatasetOrder();
  document.getElementById('clearChartBtn').disabled = false;
}

/**
 * Move a dataset up/down in the chartDatasets array.
 * Useful if you want to let the user reorder the stacked order in the chart.
 * @param {number} index
 * @param {"up"|"down"} direction
 */
function moveDataset(index, direction) {
  if (direction === 'up' && index === 0) return;
  if (direction === 'down' && index === window.chartDatasets.length - 1) return;

  const newIndex = direction === 'up' ? index - 1 : index + 1;
  [window.chartDatasets[index], window.chartDatasets[newIndex]] =
    [window.chartDatasets[newIndex], window.chartDatasets[index]];

  updateDatasetOrder();
  if (window.mainChart) {
    window.mainChart.data.datasets = window.chartDatasets;
    window.mainChart.update();
  }
}

/**
 * Removes a dataset from the chartDatasets array at the specified index
 * @param {number} index - The index of the dataset to remove
 */
function removeDataset(index) {
  if (index < 0 || index >= window.chartDatasets.length) return;
  
  // Remove the dataset at the specified index
  window.chartDatasets.splice(index, 1);
  
  // Update the dataset order list
  updateDatasetOrder();
  
  // Update the chart
  if (window.mainChart) {
    window.mainChart.data.datasets = window.chartDatasets;
    window.mainChart.update();
  }
  
  // If all datasets are removed, reset the chart state
  if (window.chartDatasets.length === 0) {
    const clearChartBtn = document.getElementById('clearChartBtn');
    if (clearChartBtn) clearChartBtn.disabled = true;
    
    if (window.mainChart) {
      window.mainChart.destroy();
      window.mainChart = null;
    }
  }
}

/**
 * Rebuild the <ul> that shows the user the order of charted datasets,
 * so they can reorder them or see which is on top/bottom, etc.
 */
function updateDatasetOrder() {
  const orderList = document.getElementById('datasetOrderList');
  if (!orderList) return;

  orderList.innerHTML = '';
  window.chartDatasets.forEach((dataset, index) => {
    const listItem = document.createElement('li');
    listItem.className = 'dataset-order-item';
    listItem.dataset.index = index; // Store the current index

    // A small color indicator
    const colorDiv = document.createElement('div');
    colorDiv.className = 'dataset-color';
    colorDiv.style.backgroundColor = dataset.backgroundColor || '#ccc';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = dataset.label;

    // Controls: up/down/remove buttons
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'dataset-order-controls';

    const upBtn = document.createElement('button');
    upBtn.textContent = '↑';
    upBtn.title = 'Move Up';
    // Use a closure to capture the current index
    upBtn.addEventListener('click', (function(currentIndex) {
      return function() { moveDataset(currentIndex, 'up'); };
    })(index));

    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.title = 'Move Down';
    // Use a closure to capture the current index
    downBtn.addEventListener('click', (function(currentIndex) {
      return function() { moveDataset(currentIndex, 'down'); };
    })(index));
    
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove from Chart';
    removeBtn.className = 'remove-dataset-btn';
    // Use a closure to capture the current index
    removeBtn.addEventListener('click', (function(currentIndex) {
      return function() { removeDataset(currentIndex); };
    })(index));

    controlsDiv.appendChild(upBtn);
    controlsDiv.appendChild(downBtn);
    controlsDiv.appendChild(removeBtn);

    listItem.appendChild(colorDiv);
    listItem.appendChild(nameSpan);
    listItem.appendChild(controlsDiv);
    orderList.appendChild(listItem);
  });
}

/**
 * Displays raw data from a selected dataset
 * @param {string|number} datasetId - ID of the dataset to display
 */
function displayRawData(datasetId) {
  const rawDataElement = document.getElementById('rawData');
  const rawDataInfo = document.querySelector('.raw-data-info');
  
  if (!rawDataElement) return;
  
  // Convert datasetId to a number if it's passed as a string
  const datasetIndex = parseInt(datasetId, 10);
  
  if (isNaN(datasetIndex) || !window.allDatasets || datasetIndex >= window.allDatasets.length) {
    rawDataElement.textContent = '';
    if (rawDataInfo) rawDataInfo.textContent = 'Select a dataset to view its raw content.';
    return;
  }
  
  const dataset = window.allDatasets[datasetIndex];
  
  // Update info about the selected dataset
  if (rawDataInfo) {
    rawDataInfo.innerHTML = `
      <strong>${dataset.name}</strong> - 
      ${dataset.rows.length} rows
    `;
  }
  
  // Format the data for display
  if (dataset.rows.length === 0) {
    rawDataElement.textContent = 'No data available in this dataset.';
    return;
  }
  
  // Get all available column names from the first row
  const columns = Object.keys(dataset.rows[0] || {});
  
  // Display the first page of data
  displayRawDataPage(dataset, columns, 0);
}

// Current page for raw data pagination
let currentPage = 0;
const rowsPerPage = 100;

/**
 * Displays a specific page of raw data
 * @param {Object} dataset - The dataset to display
 * @param {Array} columns - Array of column names
 * @param {number} page - Page number to display (0-based)
 */
function displayRawDataPage(dataset, columns, page = 0) {
  const rawDataElement = document.getElementById('rawData');
  if (!rawDataElement) return;
  
  // Update current page tracker
  currentPage = page;
  
  // Calculate start and end indices
  const startIdx = page * rowsPerPage;
  const endIdx = Math.min(startIdx + rowsPerPage, dataset.rows.length);
  
  // Create a header row
  let tableContent = columns.join('\t') + '\n';
  tableContent += columns.map(() => '--------').join('\t') + '\n';
  
  // Add data rows for current page
  for (let i = startIdx; i < endIdx; i++) {
    const row = dataset.rows[i];
    tableContent += columns.map(col => row[col] !== undefined ? row[col] : 'N/A').join('\t') + '\n';
  }
  
  // Add pagination info
  tableContent += `\n\nShowing rows ${startIdx+1} to ${endIdx} of ${dataset.rows.length}`;
  
  // Add pagination controls if dataset has more rows than one page
  if (dataset.rows.length > rowsPerPage) {
    tableContent += '\n\n';
    if (page > 0) {
      tableContent += '[Previous Page] ';
    }
    if (endIdx < dataset.rows.length) {
      tableContent += '[Next Page]';
    }
    
    // Add pagination explanation
    tableContent += '\n(Use the Raw Data Pagination controls below)';
    
    // Create pagination buttons if they don't exist
    let paginationControls = document.getElementById('rawDataPagination');
    if (!paginationControls) {
      paginationControls = document.createElement('div');
      paginationControls.id = 'rawDataPagination';
      paginationControls.className = 'pagination-controls';
      rawDataElement.parentNode.insertBefore(paginationControls, rawDataElement.nextSibling);
    }
    
    paginationControls.innerHTML = `
      <button id="prevPageBtn" ${page <= 0 ? 'disabled' : ''}>Previous Page</button>
      <span>Page ${page + 1}</span>
      <button id="nextPageBtn" ${endIdx >= dataset.rows.length ? 'disabled' : ''}>Next Page</button>
    `;
    
    // Add event listeners to pagination buttons
    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
      if (page > 0) displayRawDataPage(dataset, columns, page - 1);
    });
    
    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
      if (endIdx < dataset.rows.length) displayRawDataPage(dataset, columns, page + 1);
    });
  } else {
    // Remove pagination controls if not needed
    const paginationControls = document.getElementById('rawDataPagination');
    if (paginationControls) {
      paginationControls.remove();
    }
  }
  
  rawDataElement.textContent = tableContent;
}

// Export this function so it's available globally
window.displayRawData = displayRawData;

// Expose your chart functionality to the global scope
window.buildHistogram = buildHistogram;
window.buildQQPlot = buildQQPlot;
window.renderChart = renderChart;
window.clearChart = clearChart;
window.addToChart = addToChart;
window.moveDataset = moveDataset;
window.updateDatasetOrder = updateDatasetOrder;
window.removeDataset = removeDataset;
