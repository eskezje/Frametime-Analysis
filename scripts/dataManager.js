// dataManager.js

// We'll store multiple datasets in memory
window.allDatasets = [];

/**
 * Clears all dataset data from memory and refreshes UI elements.
 */
function clearAllDatasets() {
  window.allDatasets.length = 0;
  refreshDatasetLists();
  console.log("All datasets cleared.");
}

/**
 * Reads CSV text into an array of objects, handling numeric conversion and "NA" values.
 * @param {string} text - The CSV file contents as a string.
 * @returns {Array<Object>} The parsed rows as an array of objects.
 */
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (!lines.length) return [];

  const headers = lines[0].split(',');
  const result = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(',');

    const row = {};
    for (let j = 0; j < headers.length; j++) {
      let val = values[j] !== undefined ? values[j].trim() : null;
      if (val === 'NA') val = null;

      const asNum = parseFloat(val);
      if (!isNaN(asNum) && val !== null && val !== '') {
        row[headers[j]] = asNum; // store as number
      } else {
        row[headers[j]] = val;   // store as string/null
      }
    }
    result.push(row);
  }

  return result;
}

/**
 * Handles file selection event for CSV/TXT uploads,
 * reads each file, parses the data, and stores it in allDatasets.
 */
function handleFileUpload(e) {
  const files = e.target.files;
  if (!files.length) return;

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      const parsedRows = parseCSV(text);

      const datasetObj = {
        name: file.name,
        rows: parsedRows
      };
      window.allDatasets.push(datasetObj);
      refreshDatasetLists();
    };
    reader.readAsText(file);
  });

  // Update metric dropdowns based on available columns
  updateMetricDropdowns();
  
  // Notify the UI
  notify(`Loaded ${e.target.files.length} file(s).`, 'success');
}

/**
 * Refreshes the displayed list of datasets and updates all <select> elements
 * that let users pick datasets in other tabs (Visualization, Statistics, Tests, etc.).
 */
function refreshDatasetLists() {
  // Show list in the "Uploaded Datasets" panel
  const ul = document.getElementById('datasetList');
  ul.innerHTML = window.allDatasets
    .map(ds => `<li>${ds.name} (${ds.rows.length} rows)</li>`)
    .join('');

  // Enable or disable "Clear All" button
  document.getElementById('clearAllDatasets').disabled = (window.allDatasets.length === 0);

  // Toggle the "No datasets" info message
  document.getElementById('datasetsEmpty').classList.toggle(
    'hidden',
    window.allDatasets.length > 0
  );

  // Update the <select> in Visualization tab
  const datasetSelect = document.getElementById('datasetSelect');
  datasetSelect.innerHTML = '';
  window.allDatasets.forEach((ds, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = ds.name;
    datasetSelect.appendChild(opt);
  });

  // Update the <select> in Statistics tab
  const statSelect = document.getElementById('statDatasetSelect');
  statSelect.innerHTML = '';
  window.allDatasets.forEach((ds, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = ds.name;
    statSelect.appendChild(opt);
  });

  // Update the <select> elements in Tests tab
  const dsA = document.getElementById('datasetASelect');
  const dsB = document.getElementById('datasetBSelect');
  [dsA, dsB].forEach(sel => {
    sel.innerHTML = '';
    window.allDatasets.forEach((ds, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = ds.name;
      sel.appendChild(opt);
    });
  });
  
  // Add this to update the raw data selector
  const rawDataSelect = document.getElementById('rawDatasetSelect');
  if (rawDataSelect) {
    rawDataSelect.innerHTML = '';
    window.allDatasets.forEach((ds, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = ds.name;
      rawDataSelect.appendChild(opt);
    });
    
    // If we have at least one dataset, trigger displayRawData for the first one
    if (window.allDatasets.length > 0 && typeof window.displayRawData === 'function') {
      rawDataSelect.value = 0;
      window.displayRawData(0);
    }
  }
  
  // Dispatch a custom event to notify that datasets have been updated
  document.dispatchEvent(new CustomEvent('datasetsUpdated'));
}

/**
 * Detects which metrics are available in the loaded datasets.
 * @returns {Array<string>} Array of available metric names
 */
function detectAvailableMetrics() {
  const knownMetrics = [
    // Standard metrics
    'FrameTime', 'FPS', 'CPUBusy', 'CPUWait', 'GPUTime', 'GPUBusy', 'GPUWait',
    
    // PresentMon metrics
    'MsBetweenPresents', 'MsBetweenDisplayChange', 'MsInPresentAPI',
    'MsRenderPresentLatency', 'MsUntilDisplayed', 'MsPCLatency',
    
    // Other potential metrics
    'GPU0Util(%)', 'CPUUtil(%)'
  ];
  
  const availableMetrics = new Set(['FPS']); // FPS is always available as it's derived
  
  if (!window.allDatasets || window.allDatasets.length === 0) {
    return ['FrameTime', 'FPS']; // Default if no datasets
  }
  
  // Check each dataset
  window.allDatasets.forEach(dataset => {
    if (!dataset.rows || dataset.rows.length === 0) return;
    
    // Use the first row as a sample to check which columns exist
    const firstRow = dataset.rows[0];
    
    // Add each known metric if it exists in this dataset
    knownMetrics.forEach(metric => {
      if (typeof firstRow[metric] === 'number') {
        availableMetrics.add(metric);
      }
    });
  });
  
  return Array.from(availableMetrics);
}

/**
 * Populates metric dropdowns based on available metrics in loaded datasets
 */
function updateMetricDropdowns() {
  const availableMetrics = detectAvailableMetrics();
  
  // Get all metric select elements
  const metricSelects = [
    document.getElementById('metricSelect'),
    // Add other metric dropdowns if you have them
  ];
  
  metricSelects.forEach(select => {
    if (!select) return;
    
    // Save the currently selected value
    const currentValue = select.value;
    
    // Clear the dropdown
    select.innerHTML = '';
    
    // Add each available metric as an option
    availableMetrics.forEach(metric => {
      const option = document.createElement('option');
      option.value = metric;
      option.textContent = getMetricDisplayName(metric);
      select.appendChild(option);
    });
    
    // Try to restore the previous selection if it's still available
    if (availableMetrics.includes(currentValue)) {
      select.value = currentValue;
    } else if (availableMetrics.includes('FrameTime')) {
      select.value = 'FrameTime';
    } else if (availableMetrics.includes('FPS')) {
      select.value = 'FPS';
    }
  });
  
  // Also update the metric toggle buttons in statistics tab
  const metricGroup = document.getElementById('statMetricsGroup');
  if (metricGroup) {
    // Clear existing buttons
    metricGroup.innerHTML = '';
    
    // Add a toggle button for each available metric
    availableMetrics.forEach(metric => {
      const btn = document.createElement('button');
      btn.className = 'toggle-button';
      btn.dataset.metric = metric;
      btn.textContent = getMetricDisplayName(metric);
      
      // Activate FrameTime and FPS by default
      if (metric === 'FrameTime' || metric === 'FPS') {
        btn.classList.add('active');
      }
      
      btn.addEventListener('click', () => btn.classList.toggle('active'));
      metricGroup.appendChild(btn);
    });
  }
}

/**
 * Returns a user-friendly display name for a metric
 */
function getMetricDisplayName(metric) {
  // Display name mapping
  const displayNames = {
    'FrameTime': 'Frame Time (ms)',
    'FPS': 'Frames Per Second',
    'MsBetweenPresents': 'Time Between Presents (ms)',
    'MsBetweenDisplayChange': 'Time Between Display Changes (ms)',
    'MsInPresentAPI': 'Time in Present API (ms)',
    'MsRenderPresentLatency': 'Render-Present Latency (ms)',
    'MsUntilDisplayed': 'Time Until Displayed (ms)',
    'MsPCLatency': 'PC Latency (ms)',
    'CPUBusy': 'CPU Busy Time (ms)',
    'CPUWait': 'CPU Wait Time (ms)',
    'CPUUtil(%)': 'CPU Utilization (%)',
    'GPUBusy': 'GPU Busy Time (ms)',
    'GPUWait': 'GPU Wait Time (ms)',
    'GPU0Util(%)': 'GPU Utilization (%)'
  };
  
  return displayNames[metric] || metric;
}

// Expose them globally (so main.js or others can call them):
window.clearAllDatasets = clearAllDatasets;
window.parseCSV = parseCSV;
window.handleFileUpload = handleFileUpload;
window.refreshDatasetLists = refreshDatasetLists;
window.detectAvailableMetrics = detectAvailableMetrics;
window.updateMetricDropdowns = updateMetricDropdowns;
window.getMetricDisplayName = getMetricDisplayName;
