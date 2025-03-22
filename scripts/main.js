// main.js

document.addEventListener('DOMContentLoaded', () => {
  // 1. Handle theme preference (dark mode)
  const savedTheme = localStorage.getItem('theme');
  const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (savedTheme === 'dark' || (!savedTheme && prefersDarkMode)) {
    document.body.classList.add('dark-theme');
    const themeIcon = document.getElementById('themeIcon');
    if (themeIcon) themeIcon.textContent = '☀️';
  }

  // Add theme toggle functionality
  const themeToggle = document.querySelector('.theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      const isDark = document.body.classList.contains('dark-theme');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      
      // Update icon if it exists
      const themeIcon = document.getElementById('themeIcon');
      if (themeIcon) {
        themeIcon.textContent = isDark ? '☀️' : '🌙';
      }
    });
  }

  // 2. Set up tab switching
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.add('hidden'));

      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      if (target) {
        target.classList.remove('hidden');
        
        // Initialize Raw Data tab if we're switching to it
        if (tab.dataset.tab === 'raw' && window.allDatasets && window.allDatasets.length) {
          const rawDatasetSelect = document.getElementById('rawDatasetSelect');
          if (rawDatasetSelect && rawDatasetSelect.value) {
            window.displayRawData(rawDatasetSelect.value);
          }
        }
      }
    });
  });

  // 3. File input handling
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);  // from dataManager.js
    setupDragAndDrop(); // if you have a function for drag-and-drop
  }

  // 4. "Clear All" datasets
  const clearBtn = document.getElementById('clearAllDatasets');
  if (clearBtn) {
    clearBtn.addEventListener('click', clearAllDatasets); // from dataManager.js
  }

  // 5. Add to chart, clear chart
  const addToChartBtn = document.getElementById('addToChartBtn');
  if (addToChartBtn) {
    addToChartBtn.addEventListener('click', addToChart); // from chartManager.js
  }

  const clearChartBtn = document.getElementById('clearChartBtn');
  if (clearChartBtn) {
    clearChartBtn.addEventListener('click', clearChart); // from chartManager.js
    clearChartBtn.disabled = true;  // initially disabled until user adds a dataset
  }

  // 6. Random color generator
  const randomColorBtn = document.getElementById('randomColorBtn');
  if (randomColorBtn) {
    randomColorBtn.addEventListener('click', () => {
      const colorSelect = document.getElementById('colorSelect');
      if (colorSelect) {
        colorSelect.value = randomColor();
        updateColorPreview();
      }
    });
  }

  // 7. Chart height range
  const chartHeightRange = document.getElementById('chartHeight');
  if (chartHeightRange) {
    chartHeightRange.addEventListener('input', onChartHeightChange);
  }

  // 8. Reset zoom
  const resetZoomBtn = document.getElementById('resetZoomBtn');
  if (resetZoomBtn) {
    resetZoomBtn.addEventListener('click', resetChartZoom);
  }

  // 9. Statistics
  const calcStatsBtn = document.getElementById('calculateStatsBtn');
  if (calcStatsBtn) {
    calcStatsBtn.addEventListener('click', updateStatsTable); // from statsManager.js
  }

  const visualizeStatsBtn = document.getElementById('visualizeStatsBtn');
  if (visualizeStatsBtn) {
    visualizeStatsBtn.addEventListener('click', visualizeStatistics); // from statsManager.js
  }

  const closeStatsVisBtn = document.getElementById('closeStatsVisualizationBtn');
  if (closeStatsVisBtn) {
    closeStatsVisBtn.addEventListener('click', () => {
      const statsVisContainer = document.getElementById('statsVisualizationContainer');
      if (statsVisContainer) statsVisContainer.classList.add('hidden');
    });
  }

  // 10. Tests
  const runTestBtn = document.getElementById('runTestBtn');
  if (runTestBtn) {
    runTestBtn.addEventListener('click', runStatisticalTest); // from testManager.js
  }

  const compareSelect = document.getElementById('compareSelect');
  if (compareSelect) {
    compareSelect.addEventListener('change', updateTestUI); // you might define in testManager or main
  }

  // 11. Toggle buttons
  document.querySelectorAll('.toggle-button').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('active'));
  });

  // 12. Color preview updates
  const colorSelect = document.getElementById('colorSelect');
  if (colorSelect) {
    const previewUpdate = () => updateColorPreview();
    colorSelect.addEventListener('input', previewUpdate);
    colorSelect.addEventListener('change', previewUpdate);
    updateColorPreview(); // initialize
  }

  // 13. Initialize chart height
  if (chartHeightRange) {
    onChartHeightChange({ target: chartHeightRange });
  }

  // 14. If you have a function that sets up test UI, call it now
  updateTestUI();
  
  // 15. Add Raw Data tab functionality
  const rawDatasetSelect = document.getElementById('rawDatasetSelect');
  if (rawDatasetSelect) {
    rawDatasetSelect.addEventListener('change', function() {
      if (window.displayRawData) {
        window.displayRawData(this.value);
      }
    });
  }

  // 16. Register for dataset updates
  document.addEventListener('datasetsUpdated', function() {
    // This will be called whenever datasets are updated
    populateAllDatasetSelects();
    
    // Update metric dropdowns based on available data
    if (typeof window.updateMetricDropdowns === 'function') {
      window.updateMetricDropdowns();
    }
  });

  // 17. Any other initialization logic you need
  console.log("main.js: All event listeners set up.");

  // Initialize dataset selects on page load
  populateAllDatasetSelects();
});

// Populate all dataset selection dropdowns
function populateAllDatasetSelects() {
  // Get all dataset selection dropdowns
  const selectors = [
    document.getElementById('datasetSelect'),
    document.getElementById('statDatasetSelect'),
    document.getElementById('datasetASelect'),
    document.getElementById('datasetBSelect'),
    document.getElementById('rawDatasetSelect') // Add the raw data selector
  ];
  
  // Clear and repopulate each select
  selectors.forEach(selector => {
    if (!selector) return;
    
    // Save the currently selected value if there is one
    const currentValue = selector.value;
    
    // Clear existing options
    selector.innerHTML = '';
    
    // Add option for each dataset
    (window.allDatasets || []).forEach((dataset, id) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = dataset.name;
      selector.appendChild(option);
    });
    
    // Restore the previously selected value if it still exists
    if (currentValue && selector.querySelector(`option[value="${currentValue}"]`)) {
      selector.value = currentValue;
    }
  });
}

/**
 * Below are some helper functions that might live in main.js 
 * or in their own file; adjust as you prefer.
 */

// Update color preview
function updateColorPreview() {
  const colorInput = document.getElementById('colorSelect');
  const preview = document.getElementById('colorPreview');
  if (colorInput && preview) {
    preview.style.backgroundColor = colorInput.value;
  }
}

// Random color generator
function randomColor() {
  const r = Math.floor(30 + Math.random() * 190);
  const g = Math.floor(30 + Math.random() * 190);
  const b = Math.floor(30 + Math.random() * 190);
  return `#${r.toString(16).padStart(2, '0')
           }${g.toString(16).padStart(2, '0')
           }${b.toString(16).padStart(2, '0')}`;
}

// Chart height change
function onChartHeightChange(e) {
  const chartContainer = document.getElementById('chartContainer');
  const heightValSpan = document.getElementById('chartHeightValue');

  if (!e || !e.target) return;
  
  const val = e.target.value;
  if (heightValSpan) heightValSpan.textContent = val + 'px';
  if (chartContainer) {
    chartContainer.style.height = val + 'px';
    if (window.mainChart) {
      window.mainChart.resize();
    }
  }
}

// Reset chart zoom
function resetChartZoom() {
  if (window.mainChart && window.mainChart.resetZoom) {
    window.mainChart.resetZoom();
  }
}

// Example test UI update (if needed)
function updateTestUI() {
  const compareSelect = document.getElementById('compareSelect');
  const testDatasetContainer2 = document.getElementById('testDatasetContainer2');
  const compareValueContainer = document.getElementById('compareValueContainer');
  if (!compareSelect || !testDatasetContainer2 || !compareValueContainer) return;

  const value = compareSelect.value;
  if (value === 'dataset') {
    // Show second dataset, hide fixed value
    testDatasetContainer2.classList.remove('hidden');
    compareValueContainer.classList.add('hidden');
  } else {
    // Show fixed value, hide second dataset
    testDatasetContainer2.classList.add('hidden');
    compareValueContainer.classList.remove('hidden');
  }
}

// If you have a drag-and-drop system, define setupDragAndDrop() here
function setupDragAndDrop() {
  // Implementation of your drag-and-drop logic
  // For example, if you have a #dropZone element, set up event listeners:
  const dropZone = document.getElementById('dropZone');
  if (!dropZone) return;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length) {
      // Just call handleFileUpload with a pseudo-event
      handleFileUpload({ target: { files } });
    }
  });
}

// If you have a notify() function for user messages, define it here:
function notify(msg, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${msg}`);
  
  // Create UI notification
  const container = document.getElementById('notification-container');
  if (!container) return;
  
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <span>${msg}</span>
    <span class="notification-close">&times;</span>
  `;
  
  container.appendChild(notification);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.style.animation = 'slide-out 0.3s forwards';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
  
  // Add close button functionality
  notification.querySelector('.notification-close').addEventListener('click', () => {
    notification.style.animation = 'slide-out 0.3s forwards';
    setTimeout(() => notification.remove(), 300);
  });
}

// Export notify to the global scope
window.notify = notify;

// Add a helper function to properly calculate and display stats for a dataset and metric
window.calculateAndShowStats = function(datasetId, metric) {
  // Validate inputs
  if (typeof datasetId === 'undefined' || datasetId === '' || typeof metric !== 'string') {
    console.error('Invalid arguments to calculateAndShowStats:', datasetId, metric);
    return;
  }
  
  // Get the dataset
  const ds = window.allDatasets[datasetId];
  if (!ds) {
    console.error('Dataset not found:', datasetId);
    return;
  }
  
  // Get the values and calculate statistics
  const numericValues = ds.rows.map(r => getMetricValue(r, metric)).filter(v => typeof v === 'number');
  if (numericValues.length === 0) {
    console.error('No valid numeric values found for metric:', metric);
    return;
  }
  
  // Calculate stats with the proper metric name for FPS detection
  const stats = calculateStatistics(numericValues, metric);
  
  // Display the stats
  showVisualStats(stats, metric, ds.name);
  
  return stats;
};
