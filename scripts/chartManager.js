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
  const minVal = Math.min(...data);
  const maxVal = Math.max(...data);

  // A simple approach: #bins = sqrt(n) but capped at 50
  const binCount = Math.min(50, Math.ceil(Math.sqrt(data.length)));
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
 * Renders (or re-renders) the Chart.js chart based on the current chartDatasets array.
 * @param {string} chartType - e.g. 'line' | 'scatter' | 'bar' | 'histogram' | 'qqplot' etc.
 */
function renderChart(chartType) {
  const canvas = document.getElementById('mainChart');
  if (!canvas) {
    console.warn("mainChart canvas not found in HTML.");
    return;
  }

  const ctx = canvas.getContext('2d');
  if (window.mainChart) {
    window.mainChart.destroy();
  }
  if (!window.chartDatasets.length) {
    console.log("No datasets to render in chartDatasets.");
    return;
  }

  // Default chart is 'line', but if the user picks scatter/histogram/qqplot, adapt:
  let chartConfigType = chartType === 'scatter' ? 'scatter' : 'line';
  const scales = {};

  if (chartType === 'histogram') {
    chartConfigType = 'bar';
    scales.x = {
      type: 'category',
      title: { display: true, text: 'Bin Range' }
    };
    scales.y = {
      title: { display: true, text: 'Count' }
    };
  } else if (chartType === 'qqplot') {
    chartConfigType = 'scatter';
    scales.x = {
      type: 'linear',
      title: { display: true, text: 'Theoretical Quantiles' }
    };
    scales.y = {
      type: 'linear',
      title: { display: true, text: 'Sample Quantiles' }
    };
  } else {
    // line / scatter default
    scales.x = {
      type: 'linear',
      title: { display: true, text: 'Sample # / Frame #' }
    };
    scales.y = {
      type: 'linear',
      title: { display: true, text: 'Value' }
    };
  }

  const config = {
    type: chartConfigType,
    data: {
      datasets: window.chartDatasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: scales,
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              const ds = context.dataset;
              return `${ds.label}: ${context.formattedValue}`;
            }
          }
        },
        legend: { display: true },
        zoom: {
          pan: {
            enabled: true,
            mode: 'xy'
          },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: 'xy',
            drag: {
              enabled: true,
              backgroundColor: 'rgba(52,152,219,0.2)',
              borderColor: 'rgba(52,152,219,0.5)',
              borderWidth: 1
            }
          }
        }
      }
    }
  };

  window.mainChart = new Chart(ctx, config);
  console.log("Chart rendered with", window.chartDatasets.length, "dataset(s).");
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
  document.getElementById('datasetOrderList').innerHTML = '';
  console.log("Chart cleared");
}

/**
 * Add one or more datasets (by index) from allDatasets to the chartDatasets,
 * configured according to user’s selected metric, chart type, color, etc.
 * Then calls renderChart() to display them.
 */
function addToChart() {
  // Example based on your original logic:
  const datasetSelect = document.getElementById('datasetSelect');
  const indices = Array.from(datasetSelect.selectedOptions).map(opt => parseInt(opt.value));
  if (!indices.length) {
    console.error("No datasets selected for charting.");
    // If you have a notify() function, you could do:
    // notify("Please select at least one dataset", "warning");
    return;
  }

  const metric = document.getElementById('metricSelect').value;
  const chartType = document.getElementById('chartTypeSelect').value;
  const chosenColor = document.getElementById('colorSelect').value;

  // For each selected dataset index:
  indices.forEach(idx => {
    const ds = window.allDatasets[idx];
    if (!ds) {
      console.error(`No dataset found for index ${idx}`);
      return;
    }

    // Suppose you have a helper getMetricValue(row, metric) from statsManager
    const numericValues = ds.rows
      .map(r => getMetricValue(r, metric))
      .filter(v => v !== null && v !== undefined);

    if (!numericValues.length) {
      console.warn(`Dataset "${ds.name}" has no valid numeric data for metric "${metric}"`);
      // notify(`No valid data for ${metric} in ${ds.name}`, "warning");
      return;
    }

    // Build up the dataset config for Chart.js
    if (chartType === 'line') {
      window.chartDatasets.push({
        label: `${ds.name} - ${metric}`,
        data: numericValues.map((v, i) => ({ x: i + 1, y: v })),
        borderColor: chosenColor,
        backgroundColor: chosenColor,
        pointRadius: 1,
        fill: false,
        showLine: true
      });
    } else if (chartType === 'scatter') {
      window.chartDatasets.push({
        label: `${ds.name} - ${metric}`,
        data: numericValues.map((v, i) => ({ x: i + 1, y: v })),
        borderColor: chosenColor,
        backgroundColor: chosenColor,
        pointRadius: 3,
        showLine: false
      });
    } else if (chartType === 'histogram') {
      const binsObj = buildHistogram(numericValues);
      window.chartDatasets.push({
        label: `${ds.name} - ${metric}`,
        data: binsObj.counts.map((c, i) => ({
          x: binsObj.labels[i],
          y: c
        })),
        type: 'bar',
        backgroundColor: chosenColor
      });
    } else if (chartType === 'qqplot') {
      const qqData = buildQQPlot(numericValues);

      // Also add a "reference line" from minZ to maxZ
      const mean = jStat.mean(numericValues);
      const std = jStat.stdev(numericValues);
      const minZ = Math.min(...qqData.map(o => o.x));
      const maxZ = Math.max(...qqData.map(o => o.x));
      const refLinePoints = [
        { x: minZ, y: mean + std * minZ },
        { x: maxZ, y: mean + std * maxZ }
      ];

      window.chartDatasets.push({
        label: `${ds.name} - ${metric} (Data)`,
        data: qqData,
        borderColor: chosenColor,
        backgroundColor: chosenColor,
        pointRadius: 3,
        showLine: false
      });
      window.chartDatasets.push({
        label: `${ds.name} - ${metric} (Ref Line)`,
        data: refLinePoints,
        borderColor: '#ff0000',
        backgroundColor: '#ff0000',
        pointRadius: 0,
        borderWidth: 2,
        showLine: true
      });
    }
  });

  // Now render (or re-render) the chart
  renderChart(chartType);

  // Optionally update the dataset order list in the UI
  updateDatasetOrder();

  // Enable the "Clear Chart" button if needed
  const clearChartBtn = document.getElementById('clearChartBtn');
  if (clearChartBtn) clearChartBtn.disabled = false;

  // Add this at the end:
  if (indices.length > 0 && window.showVisualStats) {
    const lastIdx = indices[indices.length - 1];
    const lastDataset = window.allDatasets[lastIdx];
    const metric = document.getElementById('metricSelect').value;
    const data = lastDataset.rows
      .map(r => getMetricValue(r, metric))
      .filter(v => v !== null && v !== undefined);
    const stats = calculateStatistics(data);
    showVisualStats(stats, metric, lastDataset.name);
  }
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
    listItem.dataset.index = index;

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
    upBtn.addEventListener('click', () => moveDataset(index, 'up'));

    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.title = 'Move Down';
    downBtn.addEventListener('click', () => moveDataset(index, 'down'));
    
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove from Chart';
    removeBtn.className = 'remove-dataset-btn';
    removeBtn.addEventListener('click', () => removeDataset(index));

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
  
  // Create a header row
  let tableContent = columns.join('\t') + '\n';
  tableContent += columns.map(() => '--------').join('\t') + '\n';
  
  // Add data rows (limit to first 1000 for performance)
  const maxRows = Math.min(1000, dataset.rows.length);
  for (let i = 0; i < maxRows; i++) {
    const row = dataset.rows[i];
    tableContent += columns.map(col => row[col] !== undefined ? row[col] : 'N/A').join('\t') + '\n';
  }
  
  if (dataset.rows.length > maxRows) {
    tableContent += `\n... and ${dataset.rows.length - maxRows} more rows (only showing first ${maxRows})`;
  }
  
  rawDataElement.textContent = tableContent;
}

// Add to displayRawData
let currentPage = 0;
const rowsPerPage = 100;

function displayRawDataPage(dataset, page = 0) {
  // Calculate start and end indices
  const startIdx = page * rowsPerPage;
  const endIdx = Math.min(startIdx + rowsPerPage, dataset.rows.length);
  
  // Update pagination controls
  const paginationInfo = document.getElementById('rawDataPagination');
  if (paginationInfo) {
    paginationInfo.innerHTML = `
      Showing rows ${startIdx+1} to ${endIdx} of ${dataset.rows.length}
      <button id="prevPageBtn" ${page <= 0 ? 'disabled' : ''}>Previous</button>
      <button id="nextPageBtn" ${endIdx >= dataset.rows.length ? 'disabled' : ''}>Next</button>
    `;
    
    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
      if (page > 0) displayRawDataPage(dataset, page - 1);
    });
    
    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
      if (endIdx < dataset.rows.length) displayRawDataPage(dataset, page + 1);
    });
  }
  
  // Display the data for the current page
  // ...
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
