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
 * Reads CSV text into an array of objects, handling quoted strings, multiple delimiters, and line endings.
 * @param {string} text - The CSV file contents as a string.
 * @returns {Array<Object>} The parsed rows as an array of objects.
 */
function parseCSV(text) {
  // Normalize line endings (handle CRLF, CR, LF)
  text = text.replace(/\r\n|\r|\n/g, '\n');
  const lines = text.trim().split('\n');
  if (!lines.length) return [];

  // Auto-detect delimiter (comma, tab, semicolon)
  const firstLine = lines[0];
  let delimiter = ',';
  const delimiters = [',', '\t', ';'];
  const counts = delimiters.map(d => (firstLine.match(new RegExp(d, 'g')) || []).length);
  const maxIndex = counts.indexOf(Math.max(...counts));
  if (maxIndex >= 0) delimiter = delimiters[maxIndex];

  // Parse header row
  const headers = parseCSVLine(firstLine, delimiter);
  const result = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const values = parseCSVLine(line, delimiter);
    if (values.length !== headers.length) {
      console.warn(`Line ${i+1} has ${values.length} fields, expected ${headers.length}. Skipping.`);
      continue;
    }

    const row = {};
    for (let j = 0; j < headers.length; j++) {
      let val = values[j];
      if (val === 'NA' || val === '') val = null;

      const asNum = parseFloat(val);
      if (!isNaN(asNum) && val !== null) {
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
 * Parse a single CSV line, handling quoted fields with commas
 * @param {string} line - Single line from CSV
 * @param {string} delimiter - Delimiter character
 * @returns {string[]} Array of field values
 */
function parseCSVLine(line, delimiter) {
  const result = [];
  let inQuotes = false;
  let currentValue = '';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside a quoted field
        currentValue += '"';
        i++; // Skip the next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(currentValue.trim());
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  // Add the last field
  result.push(currentValue.trim());

  // Remove outer quotes and unescape inner quotes
  return result.map(val => {
    val = val.trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.substring(1, val.length - 1).replace(/""/g, '"');
    }
    return val;
  });
}

/**
 * Handles file selection event for CSV/TXT uploads,
 * reads each file, parses the data, and stores it in allDatasets.
 */
function handleFileUpload(e) {
  const files = e.target.files;
  if (!files.length) return;

  let successCount = 0;
  let errorCount = 0;

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    
    reader.onload = ev => {
      try {
        const text = ev.target.result;
        const parsedRows = parseCSV(text);
        
        if (parsedRows.length === 0) {
          // Check if notify function exists before calling it
          if (typeof window.notify === 'function') {
            window.notify(`No valid data rows found in ${file.name}`, 'warning');
          } else {
            console.warn(`No valid data rows found in ${file.name}`);
          }
          errorCount++;
          return;
        }

        const datasetObj = {
          name: file.name,
          rows: parsedRows
        };
        window.allDatasets.push(datasetObj);
        successCount++;
        
        // Only refresh if all files have been processed
        if (successCount + errorCount === files.length) {
          refreshDatasetLists();
          if (typeof window.notify === 'function') {
            window.notify(`Loaded ${successCount} file(s). ${errorCount > 0 ? errorCount + ' file(s) had errors.' : ''}`, 
                       errorCount > 0 ? 'warning' : 'success');
          } else {
            console.log(`Loaded ${successCount} file(s). ${errorCount > 0 ? errorCount + ' file(s) had errors.' : ''}`);
          }
        }
      } catch (error) {
        console.error(`Error parsing ${file.name}:`, error);
        if (typeof window.notify === 'function') {
          window.notify(`Error parsing ${file.name}: ${error.message}`, 'error');
        }
        errorCount++;
      }
    };
    
    reader.onerror = () => {
      if (typeof window.notify === 'function') {
        window.notify(`Failed to read ${file.name}`, 'error');
      } else {
        console.error(`Failed to read ${file.name}`);
      }
      errorCount++;
    };
    
    reader.readAsText(file);
  });
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

  // Use the centralized function from main.js to update all selects
  if (typeof window.populateAllDatasetSelects === 'function') {
    window.populateAllDatasetSelects();
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
    // Add other metric dropdowns if you have them Add test metric select
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
    'FPS': 'FPS',
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
window.parseCSVLine = parseCSVLine;
