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

const FRAME_ALIASES = [
  { key:'frametime',             scale:1     },
  { key:'frametime(ms)',         scale:1     },
  { key:'frametime(us)',         scale:0.001 },
  { key:'msbetweenpresents',     scale:1     },
  { key:'frame delta time(ms)',  scale:1     }
];

function canonKey(str){          // lower‑case & strip spaces
  return str.toLowerCase().replace(/\s+/g,'');
}

const METRIC_BLACKLIST = new Set([
  'Application','GPU','CPU','Resolution','Runtime','ProcessID','SwapChainAddress',
  'PresentFlags','FlipToken', 'AllowsTearing', 'SyncInterval', 'Dropped', 'TimeInSeconds',
  'CPUStartTime', 'PresentMode',
]);

// global UI flag (default = basic mode)
window.showAdvancedMetrics = false;


/**
 * Ensures row.FrameTime and row.FPS exist, creating them from aliases when
 * necessary.
 */
function normaliseRow(row){
  const map = {};
  Object.keys(row).forEach(k => map[ canonKey(k) ] = k);

  /* FrameTime ----------------------------------------------------------- */
  if (row.FrameTime == null){
    for (const {key,scale} of FRAME_ALIASES){
      const m = map[key];
      if (m){
        const v = Number(row[m]);
        if (Number.isFinite(v)){
          row.FrameTime = v * scale;
          break;
        }
      }
    }
  }

  /* FPS ----------------------------------------------------------------- */
  if (row.FPS == null){
    const fpsKey = map['fps'];
    if (fpsKey && Number.isFinite(row[fpsKey])){
      row.FPS = Number(row[fpsKey]);
    } else if (Number.isFinite(row.FrameTime) && row.FrameTime > 0){
      row.FPS = 1000 / row.FrameTime;           // derive from FT
    }
  }

  /* Back‑fill FrameTime from FPS if still missing ---------------------- */
  if (row.FrameTime == null && Number.isFinite(row.FPS) && row.FPS > 0){
    row.FrameTime = 1000 / row.FPS;
  }
}


/**
 * Generic JSON‑table reader (CapFrameX today, other tools tomorrow)
 * ---------------------------------------------------------------
 *  • Detects the “per‑frame array” length (taken from MsBetweenPresents).
 *  • Copies *all* CaptureData fields that are arrays of that length.
 *  • Still runs normaliseRow() to create FrameTime / FPS aliases.
 *  • Returns an [] of plain row objects that plug into the rest of
 *    your pipeline unchanged.
 */
function parseCfxJson(text, fileName){
  let json;
  try{
    json = JSON.parse(text);
  }catch(e){
    console.warn('Not valid JSON:', fileName);
    return [];
  }
  if (!json?.Runs?.length){
    console.warn('No Runs[] array in file:', fileName);
    return [];
  }

  const rows = [];

  json.Runs.forEach(run=>{
    const cd = run.CaptureData ?? {};

    // Determine how many frames we have – fall back to longest array
    let frames = Array.isArray(cd.MsBetweenPresents) ? cd.MsBetweenPresents.length : 0;
    if (!frames){
      // grab the first array length we can find
      for (const v of Object.values(cd)){
        if (Array.isArray(v)){ frames = v.length; break; }
      }
    }
    if (!frames){ return; }   // nothing useful in this run

    for (let i=0; i<frames; i++){
      const r = {};

      // copy every per‑frame column
      Object.entries(cd).forEach(([key,val])=>{
        if (Array.isArray(val) && i < val.length){
          r[key] = val[i];
        }
      });

      // un‑alias MsBetweenPresents → FrameTime (ms)
      if (r.MsBetweenPresents != null && r.FrameTime == null){
        r.FrameTime = r.MsBetweenPresents;      // already in ms
      }

      normaliseRow(r);          // adds FPS / fills aliases & gaps
      rows.push(r);
    }
  });

  return rows;
}





/**
 * Reads CSV text into an array of objects, handling quoted strings, multiple delimiters, and line endings.
 * @param {string} text - The CSV file contents as a string.
 * @returns {Array<Object>} The parsed rows as an array of objects.
 */
function parseCSV(text) {
  text = text.replace(/\r\n|\r|\n/g, '\n').trim();
  const lines = text.split('\n');
  if (!lines.length) return [];

  const delimiter = [',','\t',';'].sort(
    (a,b)=> lines[0].split(b).length - lines[0].split(a).length
  )[0];

  const headers = parseCSVLine(lines[0], delimiter);
  return lines.slice(1).map(line => {
    const vals = parseCSVLine(line, delimiter);
    const obj  = {};
    headers.forEach((h,i)=>{
      const raw = vals[i]?.trim() ?? '';
      const num = Number(raw);
      obj[h] = Number.isFinite(num) ? num : raw || null;
    });
    normaliseRow(obj);
    return obj;
  });
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
        const parsedRows = file.name.toLowerCase().endsWith('.json')
                                    ? parseCfxJson(text, file.name)
                                    : parseCSV(text);
        
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

function detectAvailableMetrics() {
  const metrics = new Set(['FPS', 'FrameTime']);      // always keep these

  window.allDatasets.forEach(ds => {
    if (!ds.rows?.length) return;
    const sample = ds.rows[0];
    Object.keys(sample).forEach(k => {
      if (
        typeof sample[k] === 'number' &&
        !METRIC_BLACKLIST.has(k)
      ) {
        metrics.add(k);
      }
    });
  });

  // basic ⇄ advanced toggle
  if (!window.showAdvancedMetrics) {
    return ['FPS', 'FrameTime'];
  }
  return Array.from(metrics);
}

/**
 * Build metric list based on selected datasets.
 * - If no dataset selected: union of all numeric columns (still respects basic vs advanced).
 * - If ≥1 selected: intersection of numeric columns across them.
 * - Always ensure FrameTime / FPS present if derivable.
 */
function updateMetricDropdowns() {
  const metricSelects = [
    document.getElementById('metricSelect'),
    document.getElementById('testMetricSelect')
  ];
  const statsMetricGroup = document.getElementById('statMetricsGroup');
  const dsSelect = document.getElementById('datasetSelect');

  // Helper: collect numeric columns from a dataset (looking across a few rows)
  function numericColumns(ds) {
    if (!ds?.rows?.length) return new Set();
    const cols = Object.keys(ds.rows[0] || {});
    const numeric = new Set();
    cols.forEach(col => {
      // skip blacklisted
      if (METRIC_BLACKLIST.has(col)) return;
      // probe up to first 15 rows to see if any numeric value appears
      for (let i = 0; i < Math.min(15, ds.rows.length); i++) {
        const v = ds.rows[i][col];
        if (v === null || v === '' || v === undefined) continue;
        const num = Number(v);
        if (Number.isFinite(num)) {
          numeric.add(col);
          break;
        }
      }
    });
    // Make sure FrameTime / FPS appear if derived
    if (ds.rows.some(r => Number.isFinite(r.FrameTime))) numeric.add('FrameTime');
    if (ds.rows.some(r => Number.isFinite(r.FPS)))       numeric.add('FPS');
    return numeric;
  }

  // Determine selection
  const selectedIdxs = dsSelect
    ? Array.from(dsSelect.selectedOptions).map(o => +o.value)
    : [];

  let metrics;

  if (!selectedIdxs.length) {
    // UNION
    const union = new Set();
    (window.allDatasets || []).forEach(ds => {
      numericColumns(ds).forEach(c => union.add(c));
    });
    metrics = Array.from(union);
  } else {
    // INTERSECTION
    let inter = null;
    selectedIdxs.forEach(idx => {
      const cols = numericColumns(window.allDatasets[idx]);
      if (inter == null) {
        inter = new Set(cols);
      } else {
        inter = new Set([...inter].filter(c => cols.has(c)));
      }
    });
    metrics = inter ? Array.from(inter) : [];
  }

  // Basic vs advanced mode: if basic, restrict to FrameTime & FPS only (if present)
  if (!window.showAdvancedMetrics) {
    metrics = metrics.filter(m => m === 'FrameTime' || m === 'FPS');
  }

  // Sort alpha for stability
  metrics.sort((a,b) => a.localeCompare(b));

  // --- Populate dropdowns ---
  const previousValues = metricSelects.map(sel => sel && sel.value);

  metricSelects.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    metrics.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = getMetricDisplayName(m);
      sel.appendChild(opt);
    });
  });

  // Try restore old selection
  metricSelects.forEach((sel,i) => {
    if (!sel) return;
    const prev = previousValues[i];
    if (prev && metrics.includes(prev)) {
      sel.value = prev;
    } else if (metrics.includes('FrameTime')) {
      sel.value = 'FrameTime';
    } else if (metrics.includes('FPS')) {
      sel.value = 'FPS';
    }
  });

  // Statistics tab toggle buttons
  if (statsMetricGroup) {
    statsMetricGroup.innerHTML = '';
    metrics.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'toggle-button';
      btn.dataset.metric = m;
      btn.textContent = getMetricDisplayName(m);
      if (m === 'FrameTime' || m === 'FPS') btn.classList.add('active');
      btn.addEventListener('click', () => btn.classList.toggle('active'));
      statsMetricGroup.appendChild(btn);
    });
  }

  // Disable selects if empty
  metricSelects.forEach(sel => {
    if (!sel) return;
    sel.disabled = metrics.length === 0;
  });

  if (metrics.length === 0 && selectedIdxs.length > 1) {
    notify('No common numeric metrics across selected datasets.', 'warning');
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
