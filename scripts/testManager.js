// testManager.js

/**
 * Orchestrates running whichever test the user selected (#testSelect)
 * against either two datasets or a single dataset vs. fixed value.
 */
function runStatisticalTest() {
    const testType = document.getElementById('testSelect').value;
    const metric = document.getElementById('testMetricSelect').value;
    const compareType = document.getElementById('compareSelect').value;
  
    const resultsDiv = document.getElementById('testResults');
    const resultsContent = document.getElementById('testResultsContent');
    const interpretationDiv = document.getElementById('testInterpretation');
  
    if (!resultsDiv || !resultsContent || !interpretationDiv) return;
  
    // Show the results panel
    resultsDiv.classList.remove('hidden');
    resultsContent.innerHTML = '';
    interpretationDiv.innerHTML = '';
  
    if (!window.allDatasets.length) {
      resultsContent.innerHTML = 'No datasets loaded.';
      return;
    }
  
    let dataA = [];
    let dataB = [];
  
    if (compareType === 'dataset') {
      // Compare two uploaded datasets
      const dsAIndex = document.getElementById('datasetASelect').value;
      const dsBIndex = document.getElementById('datasetBSelect').value;
      if (dsAIndex === '' || dsBIndex === '') {
        resultsContent.innerHTML = 'Select two datasets.';
        return;
      }
  
      const dsAObj = window.allDatasets[dsAIndex];
      const dsBObj = window.allDatasets[dsBIndex];
      if (!dsAObj || !dsBObj) {
        resultsContent.innerHTML = 'One or both datasets not found.';
        return;
      }
  
      dataA = dsAObj.rows.map(r => getMetricValue(r, metric)).filter(v => typeof v === 'number');
      dataB = dsBObj.rows.map(r => getMetricValue(r, metric)).filter(v => typeof v === 'number');
      if (!dataA.length || !dataB.length) {
        resultsContent.innerHTML = 'One or both datasets had no valid data for that metric.';
        return;
      }
    } else {
      // Single dataset vs. numeric value
      const dsAIndex = document.getElementById('datasetASelect').value;
      if (dsAIndex === '') {
        resultsContent.innerHTML = 'Select a dataset.';
        return;
      }
  
      const dsAObj = window.allDatasets[dsAIndex];
      if (!dsAObj) {
        resultsContent.innerHTML = 'Dataset not found.';
        return;
      }
  
      dataA = dsAObj.rows.map(r => getMetricValue(r, metric)).filter(v => typeof v === 'number');
      if (!dataA.length) {
        resultsContent.innerHTML = 'Dataset had no valid data for that metric.';
        return;
      }
  
      const fixedVal = parseFloat(document.getElementById('compareValue').value) || 0;
      dataB = dataA.map(() => fixedVal);
    }
  
    // Truncate if lengths differ
    const n = Math.min(dataA.length, dataB.length);
    if (dataA.length !== dataB.length) {
      resultsContent.innerHTML += `<p>Arrays differ in length. Truncating to length ${n}.</p>`;
      dataA = dataA.slice(0, n);
      dataB = dataB.slice(0, n);
    }
    if (n === 0) {
      resultsContent.innerHTML += 'No data available after truncation.';
      return;
    }
  
    // Switch on test type
    if (testType === 'ttest') {
      const tRes = runPairedTTest(dataA, dataB, resultsContent);
      if (tRes && typeof tRes.cohenD === 'number') {
        interpretTTestResult(tRes.cohenD);
      }
    } else if (testType === 'wilcoxon') {
      const wRes = runWilcoxon(dataA, dataB, resultsContent);
      if (wRes && typeof wRes.rbc === 'number') {
        interpretWilcoxonResult(wRes.rbc);
      }
    } else if (testType === 'shapiro') {
      runShapiroWilkTest(dataA, resultsContent);
    } else if (testType === 'variance') {
      runVarianceTest(dataA, dataB, resultsContent);
    } else if (testType === 'framepacing') {
      runFramePacingTest(dataA, dataB, resultsContent);
    }
  }
  
  /**
   * Paired t-test (two dependent samples).
   * Cohen's d is computed as difference mean / difference stdev.
   */
  function runPairedTTest(a, b, resultsDiv) {
    if (a.length !== b.length) {
      resultsDiv.innerHTML += 'Paired t-test requires arrays of the same length.<br/>';
      return;
    }
    const n = a.length;
    const diffs = a.map((val, i) => val - b[i]);
    const meanDiff = jStat.mean(diffs);
    const sdDiff = jStat.stdev(diffs, true); // sample stdev
    const se = sdDiff / Math.sqrt(n);
    const t = meanDiff / se;
    const dof = n - 1;
    const pTwoTailed = 2 * (1 - jStat.studentt.cdf(Math.abs(t), dof));
    const cohenD = meanDiff / sdDiff;
  
    // 95% CI
    const tCritical = jStat.studentt.inv(0.975, dof);
    const margin = tCritical * se;
    const ciLower = meanDiff - margin;
    const ciUpper = meanDiff + margin;
  
    resultsDiv.innerHTML += `
      <p><strong>Paired t-test</strong><br/>
      n = ${n}, t = ${t.toFixed(4)}, dof = ${dof}, p-value = ${pTwoTailed.toFixed(6)}<br/>
      Mean Diff = ${meanDiff.toFixed(4)} (95% CI: ${ciLower.toFixed(4)} to ${ciUpper.toFixed(4)})<br/>
      Cohen's d = ${cohenD.toFixed(4)}
      </p>
    `;
  
    return { t, dof, pValue: pTwoTailed, meanDiff, se, ci: [ciLower, ciUpper], cohenD };
  }
  
  /**
   * Wilcoxon Signed-Rank test for paired data.
   * Rank-Biserial correlation is used for effect size (RBC).
   */
  function runWilcoxon(a, b, resultsDiv) {
    if (a.length !== b.length) {
      resultsDiv.innerHTML += 'Wilcoxon Signed-Rank requires equal lengths.<br/>';
      return;
    }
    const n = a.length;
    const diffs = a.map((val, i) => val - b[i]);
    const nonZeroDiffs = diffs.filter(d => d !== 0);
    if (!nonZeroDiffs.length) {
      resultsDiv.innerHTML += 'All differences are zero.<br/>';
      return;
    }
  
    // Ranking absolute differences
    const absDiffs = nonZeroDiffs.map(d => ({ val: Math.abs(d), sign: Math.sign(d) }));
    absDiffs.sort((x, y) => x.val - y.val);
    absDiffs.forEach((obj, idx) => { obj.rank = idx + 1; });
  
    const Wplus = absDiffs.filter(o => o.sign > 0).reduce((acc, o) => acc + o.rank, 0);
    const Wminus = absDiffs.filter(o => o.sign < 0).reduce((acc, o) => acc + o.rank, 0);
    const T = Math.min(Wplus, Wminus);
  
    const nUsed = absDiffs.length;
    const meanT = nUsed * (nUsed + 1) / 4;
    const sdT = Math.sqrt(nUsed * (nUsed + 1) * (2 * nUsed + 1) / 24);
    const z = (T - meanT) / sdT;
    const pVal = 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1));
  
    // Rank-Biserial correlation
    const RBC = 1 - (2 * Wminus) / (nUsed * (nUsed + 1) / 2);
  
    resultsDiv.innerHTML += `
      <p><strong>Wilcoxon Signed-Rank</strong><br/>
      n = ${nUsed}, W+ = ${Wplus.toFixed(4)}, W- = ${Wminus.toFixed(4)}, T = ${T.toFixed(4)}<br/>
      z = ${z.toFixed(4)}, p-value ~ ${pVal.toFixed(6)}<br/>
      Rank-Biserial Corr = ${RBC.toFixed(4)}
      </p>
    `;
  
    return { Wplus, Wminus, T, z, pVal, rbc: RBC };
  }
  
  /**
   * Shapiro-Wilk normality test on a single dataset.
   */
  function runShapiroWilkTest(data, resultsDiv) {
    // Implementation of Shapiro-Wilk test
    // Limited version as full implementation is complex
    if (data.length < 3 || data.length > 5000) {
      resultsDiv.innerHTML += '<p>Shapiro-Wilk test requires 3-5000 data points.</p>';
      return;
    }
    
    // Sort the data
    const sorted = [...data].sort((a, b) => a - b);
    const n = sorted.length;
    
    // Calculate mean
    const mean = jStat.mean(sorted);
    
    // Step 1: Calculate the sum of squares
    const ss = sorted.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);
    
    // Step 2: Generate the coefficients (simplified version)
    const coefficients = [];
    for (let i = 0; i < Math.floor(n/2); i++) {
      // This is a simplified approximation - real coefficients are more complex
      const coef = (n - 1 - 2*i) / (n * Math.sqrt(n * (n-1)));
      coefficients.push(coef);
    }
    
    // Step 3: Calculate the b value
    let b = 0;
    for (let i = 0; i < Math.floor(n/2); i++) {
      b += coefficients[i] * (sorted[n-1-i] - sorted[i]);
    }
    
    // Step 4: Calculate the W statistic
    const W = (b * b) / ss;
    
    // Step 5: Calculate approximate p-value
    // Note: This is a simplified approximation
    const z = (-Math.log(1 - W) - 0.0006714 + 0.25 * Math.pow(n, -0.168)) / (0.459 + 0.27 / Math.sqrt(n));
    const pValue = 1 - jStat.normal.cdf(z, 0, 1);
    
    // Display results
    const isNormal = pValue > 0.05;
    resultsDiv.innerHTML += `
      <p><strong>Shapiro-Wilk Normality Test</strong><br/>
      W = ${W.toFixed(4)}, p-value = ${pValue.toFixed(6)}<br/>
      Interpretation: Data ${isNormal ? 'appears to follow' : 'deviates from'} a normal distribution.</p>
    `;
    
    return { W, pValue, isNormal };
  }
  
  /**
   * F-test for comparing variances of two datasets.
   */
  function runVarianceTest(a, b, resultsDiv) {
    const n1 = a.length;
    const n2 = b.length;
    
    if (n1 < 2 || n2 < 2) {
      resultsDiv.innerHTML += '<p>Variance test requires at least 2 data points per group.</p>';
      return;
    }
    
    // Calculate variances
    const var1 = jStat.variance(a, true);
    const var2 = jStat.variance(b, true);
    
    // Calculate coefficient of variation (CV)
    const mean1 = jStat.mean(a);
    const mean2 = jStat.mean(b);
    const cv1 = (Math.sqrt(var1) / mean1) * 100; // as percentage
    const cv2 = (Math.sqrt(var2) / mean2) * 100; // as percentage
    
    // F-test for variance ratio
    const F = var1 > var2 ? var1 / var2 : var2 / var1;
    const numeratorDof = var1 > var2 ? n1 - 1 : n2 - 1;
    const denominatorDof = var1 > var2 ? n2 - 1 : n1 - 1;
    
    // Calculate p-value (two-tailed)
    let pValue = 2 * (1 - jStat.ftest(F, numeratorDof, denominatorDof));
    if (pValue > 1) pValue = 2 - pValue; // Adjust for two-tailed test
    
    resultsDiv.innerHTML += `
      <p><strong>Variance Comparison (F-test)</strong><br/>
      Dataset A: Variance = ${var1.toFixed(4)}, CV = ${cv1.toFixed(2)}%<br/>
      Dataset B: Variance = ${var2.toFixed(4)}, CV = ${cv2.toFixed(2)}%<br/>
      F = ${F.toFixed(4)}, df1 = ${numeratorDof}, df2 = ${denominatorDof}, p-value = ${pValue.toFixed(6)}<br/>
      Interpretation: The variances are ${pValue > 0.05 ? 'not significantly different' : 'significantly different'} (α = 0.05)</p>
    `;
    
    return { var1, var2, cv1, cv2, F, pValue };
  }
  
  /**
   * Frame pacing test comparing two sets of frametimes.
   * Assesses frame-to-frame consistency and highlights differences.
   */
  function runFramePacingTest(a, b, resultsDiv) {
    // Only meaningful for FrameTime metrics
    const pacingA = analyzeFramePacing(a);
    const pacingB = analyzeFramePacing(b);
    
    // Calculate practical significance
    const consistencyDiff = pacingB.consistency - pacingA.consistency;
    const avgTransitionDiff = pacingA.avgTransition - pacingB.avgTransition;
    const badTransitionsDiff = pacingA.badTransitions.length - pacingB.badTransitions.length;
    
    resultsDiv.innerHTML += `
      <p><strong>Frame Pacing Analysis</strong></p>
      <p>Dataset A: 
        <ul>
          <li>Frame Pacing Consistency: ${pacingA.consistency.toFixed(2)}%</li>
          <li>Average Frame-to-Frame Transition: ${pacingA.avgTransition.toFixed(4)}ms</li>
          <li>Bad Transitions: ${pacingA.badTransitions.length} frames</li>
        </ul>
      </p>
      <p>Dataset B: 
        <ul>
          <li>Frame Pacing Consistency: ${pacingB.consistency.toFixed(2)}%</li>
          <li>Average Frame-to-Frame Transition: ${pacingB.avgTransition.toFixed(4)}ms</li>
          <li>Bad Transitions: ${pacingB.badTransitions.length} frames</li>
        </ul>
      </p>
      <p>Differences (B - A):
        <ul>
          <li>Consistency: ${consistencyDiff.toFixed(2)}% ${consistencyDiff > 0 ? '✅' : '❌'}</li>
          <li>Avg Transition: ${(-avgTransitionDiff).toFixed(4)}ms ${avgTransitionDiff > 0 ? '✅' : '❌'}</li>
          <li>Bad Transitions: ${(-badTransitionsDiff)} frames ${badTransitionsDiff > 0 ? '✅' : '❌'}</li>
        </ul>
      </p>
      <p>Practical Assessment: ${
        consistencyDiff > 5 ? 'Significant improvement in frame pacing' : 
        consistencyDiff > 2 ? 'Moderate improvement in frame pacing' :
        consistencyDiff > 0 ? 'Slight improvement in frame pacing' :
        consistencyDiff > -2 ? 'Negligible change in frame pacing' :
        'Degradation in frame pacing'
      }</p>
    `;
    
    return { pacingA, pacingB, consistencyDiff, avgTransitionDiff, badTransitionsDiff };
  }
  
  /**
   * Interprets the t-test effect size (Cohen's d) and adds text to #testInterpretation.
   * e.g. small < 0.2, medium ~ 0.5, large ~ 0.8
   */
  function interpretTTestResult(cohenD) {
    const interpDiv = document.getElementById('testInterpretation');
    if (!interpDiv) return;
  
    const absD = Math.abs(cohenD);
    let effectSizeText, effectSizeClass;
    
    if (absD < 0.2) {
      effectSizeText = "negligible";
      effectSizeClass = "";
    } else if (absD < 0.5) {
      effectSizeText = "small";
      effectSizeClass = "effect-size-small";
    } else if (absD < 0.8) {
      effectSizeText = "medium";
      effectSizeClass = "effect-size-medium";
    } else {
      effectSizeText = "large";
      effectSizeClass = "effect-size-large";
    }
    
    interpDiv.innerHTML = `
      <p><strong>Interpretation:</strong> The effect size (Cohen's d = ${cohenD.toFixed(2)}) indicates a 
      <span class="${effectSizeClass} effect-size-indicator">${effectSizeText}</span> effect.</p>
      <p>Guidelines for Cohen's d interpretation:</p>
      <ul>
        <li>d < 0.2: Negligible effect</li>
        <li>0.2 ≤ d < 0.5: Small effect</li>
        <li>0.5 ≤ d < 0.8: Medium effect</li>
        <li>d ≥ 0.8: Large effect</li>
      </ul>
    `;
  }
  
  /**
   * Interprets the Wilcoxon result (Rank-Biserial correlation, RBC) in #testInterpretation.
   * Typically RBC around 0.3 is small, 0.5 is medium, 0.7 is large, etc.
   */
  function interpretWilcoxonResult(rbc) {
    const interpDiv = document.getElementById('testInterpretation');
    if (!interpDiv) return;
  
    const absRBC = Math.abs(rbc);
    let effectSizeText, effectSizeClass;
    
    if (absRBC < 0.1) {
      effectSizeText = "negligible";
      effectSizeClass = "";
    } else if (absRBC < 0.3) {
      effectSizeText = "small";
      effectSizeClass = "effect-size-small";
    } else if (absRBC < 0.5) {
      effectSizeText = "medium";
      effectSizeClass = "effect-size-medium";
    } else {
      effectSizeText = "large";
      effectSizeClass = "effect-size-large";
    }
    
    interpDiv.innerHTML = `
      <p><strong>Interpretation:</strong> The effect size (Rank-Biserial Correlation = ${rbc.toFixed(2)}) indicates a 
      <span class="${effectSizeClass} effect-size-indicator">${effectSizeText}</span> effect.</p>
      <p>Guidelines for Rank-Biserial Correlation interpretation:</p>
      <ul>
        <li>|r| < 0.1: Negligible effect</li>
        <li>0.1 ≤ |r| < 0.3: Small effect</li>
        <li>0.3 ≤ |r| < 0.5: Medium effect</li>
        <li>|r| ≥ 0.5: Large effect</li>
      </ul>
    `;
  }
  
  // Expose these functions globally so main.js (or others) can call them
  window.runStatisticalTest = runStatisticalTest;
  window.runPairedTTest = runPairedTTest;
  window.runWilcoxon = runWilcoxon;
  window.runShapiroWilkTest = runShapiroWilkTest;
  window.runVarianceTest = runVarianceTest;
  window.runFramePacingTest = runFramePacingTest;
  window.interpretTTestResult = interpretTTestResult;
  window.interpretWilcoxonResult = interpretWilcoxonResult;
