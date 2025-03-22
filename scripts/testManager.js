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

  // Only truncate if needed for paired tests
  if (testType === 'ttest') {
    const n = Math.min(dataA.length, dataB.length);
    if (dataA.length !== dataB.length) {
      resultsContent.innerHTML += `<p>Arrays differ in length. Truncating to length ${n} for paired test.</p>`;
      dataA = dataA.slice(0, n);
      dataB = dataB.slice(0, n);
    }
    if (n === 0) {
      resultsContent.innerHTML += 'No data available after truncation.';
      return;
    }
  }

  // Switch on test type
  if (testType === 'ttest') {
    const tRes = runPairedTTest(dataA, dataB, resultsContent);
    if (tRes && typeof tRes.cohenD === 'number') {
      interpretTTestResult(tRes.cohenD);
    }
  } else if (testType === 'mannwhitney') {
    const mwRes = runMannWhitneyTest(dataA, dataB, resultsContent);
    if (mwRes && typeof mwRes.effectSize === 'number') {
      interpretMannWhitneyResult(mwRes.effectSize, mwRes.pValue);
    }
  } else if (testType === 'kstest') {
    const ksRes = runKolmogorovSmirnovTest(dataA, dataB, resultsContent);
    if (ksRes && typeof ksRes.effectSize === 'number') {
      interpretKSTestResult(ksRes.effectSize, ksRes.pValue, ksRes.skewA, ksRes.skewB, ksRes.maxDiffValue);
    }
  } else if (testType === 'variance') {
    const fRes = runVarianceTest(dataA, dataB, resultsContent);
    if (fRes && typeof fRes.effectSize === 'number') {
      interpretVarianceTest(fRes.effectSize, fRes.pValue);
    }
  } else if (testType === 'framepacing') {
    const fpRes = runFramePacingTest(dataA, dataB, resultsContent);
    interpretFramePacingResult(fpRes.consistencyDiff);
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
  
  // Determine degree of normality for interpretation
  let normalityText, normalityClass;
  if (pValue > 0.5) {
    normalityText = "strongly normal";
    normalityClass = "effect-size-small";
  } else if (pValue > 0.05) {
    normalityText = "normal";
    normalityClass = "effect-size-medium";
  } else if (pValue > 0.01) {
    normalityText = "moderately non-normal";
    normalityClass = "effect-size-large";
  } else {
    normalityText = "strongly non-normal";
    normalityClass = "effect-size-large";
  }
  
  resultsDiv.innerHTML += `
    <p><strong>Shapiro-Wilk Normality Test</strong><br/>
    W = ${W.toFixed(4)}, p-value = ${pValue.toFixed(6)}<br/>
    Interpretation: Data appears to be <span class="${normalityClass} effect-size-indicator">${normalityText}</span> 
    (α = 0.05)</p>
    
    <p>Guidelines for normality interpretation:</p>
    <ul>
      <li>p > 0.5: Strongly normal distribution</li>
      <li>0.05 < p ≤ 0.5: Normal distribution</li>
      <li>0.01 < p ≤ 0.05: Moderately non-normal</li>
      <li>p ≤ 0.01: Strongly non-normal</li>
    </ul>
  `;
  
  return { W, pValue, isNormal };
}

/**
 * Improved F-test for comparing variances of two datasets.
 * Includes effect size calculation and better interpretation.
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
  
  // Calculate effect size - we'll use natural logarithm of F
  // This converts the ratio to a more comparable scale
  const effectSize = Math.log(F);
  
  // Determine which variance is larger for reporting
  const largerVariance = var1 > var2 ? 'A' : 'B';
  const varianceRatio = var1 > var2 ? var1 / var2 : var2 / var1;
  
  resultsDiv.innerHTML += `
    <p><strong>Variance Comparison (F-test)</strong><br/>
    Dataset A: Variance = ${var1.toFixed(4)}, CV = ${cv1.toFixed(2)}%<br/>
    Dataset B: Variance = ${var2.toFixed(4)}, CV = ${cv2.toFixed(2)}%<br/>
    F = ${F.toFixed(4)}, df1 = ${numeratorDof}, df2 = ${denominatorDof}, p-value = ${pValue.toFixed(6)}<br/>
    Effect Size (ln(F)) = ${effectSize.toFixed(4)}<br/>
    Dataset ${largerVariance} has ${varianceRatio.toFixed(2)}× the variance of the other dataset</p>
  `;
  
  return { var1, var2, cv1, cv2, F, pValue, effectSize, largerDataset: largerVariance };
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
        <li>Median Frametime: ${pacingA.medianFrametime.toFixed(4)}ms</li>
        <li>Median Frame-to-Frame Transition: ${pacingA.medianTransition.toFixed(4)}ms</li>
        <li>Bad Transitions: ${pacingA.badTransitions.length} frames</li>
      </ul>
    </p>
    <p>Dataset B: 
      <ul>
        <li>Frame Pacing Consistency: ${pacingB.consistency.toFixed(2)}%</li>
        <li>Median Frametime: ${pacingB.medianFrametime.toFixed(4)}ms</li>
        <li>Median Frame-to-Frame Transition: ${pacingB.medianTransition.toFixed(4)}ms</li>
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
  `;
  
  // Add new visualizations
  visualizeBootstrapCI(a, b, resultsDiv);
  visualizeFrameTimeStability(a, b, resultsDiv);
  
  return { pacingA, pacingB, consistencyDiff, avgTransitionDiff, badTransitionsDiff };
}

/**
 * Enhanced Mann-Whitney U Test with proper tie handling and performance optimizations
 * for large frametime datasets (hundreds or thousands of samples).
 */
function runMannWhitneyTest(a, b, resultsDiv) {
  const n1 = a.length;
  const n2 = b.length;
  
  if (n1 < 5 || n2 < 5) {
    resultsDiv.innerHTML += '<p>Mann-Whitney test works best with at least 5 data points per group.</p>';
    if (n1 < 1 || n2 < 1) return null;
  }
  
  // Performance optimization: Pre-allocate combined array to avoid resizing
  const combined = new Array(n1 + n2);
  for (let i = 0; i < n1; i++) {
    combined[i] = { value: a[i], group: 'a' };
  }
  for (let i = 0; i < n2; i++) {
    combined[n1 + i] = { value: b[i], group: 'b' };
  }
  
  // Sort by value - the conditional is unnecessary since the same sort function is used in both branches
  combined.sort((x, y) => x.value - y.value);
  
  // Assign ranks (with improved tie handling)
  let currentRank = 1;
  let tieCorrection = 0; // Sum of (t³-t)/12 for each group of ties
  
  for (let i = 0; i < combined.length;) {
    const value = combined[i].value;
    const tieStart = i;
    
    // Find the end of the tie group
    while (i < combined.length && combined[i].value === value) {
      i++;
    }
    
    // Calculate tie stats
    const tieCount = i - tieStart;
    const avgRank = currentRank + (tieCount - 1) / 2;
    
    // Proper tie correction calculation
    if (tieCount > 1) {
      tieCorrection += (Math.pow(tieCount, 3) - tieCount) / 12;
    }
    
    // Assign the average rank to all tied values
    for (let j = tieStart; j < i; j++) {
      combined[j].rank = avgRank;
    }
    
    currentRank += tieCount;
  }
  
  // Step 2: Sum ranks for each group
  let rankSumA = 0;
  let rankSumB = 0;
  
  for (const item of combined) {
    if (item.group === 'a') {
      rankSumA += item.rank;
    } else {
      rankSumB += item.rank;
    }
  }
  
  // Step 3: Calculate U statistics
  const U1 = rankSumA - (n1 * (n1 + 1)) / 2;
  const U2 = n1 * n2 - U1; // Alternative calculation: rankSumB - (n2 * (n2 + 1)) / 2;
  
  const U = Math.min(U1, U2);
  const meanU = (n1 * n2) / 2;
  
  // Step 4: Improved variance calculation with tie correction
  const N = n1 + n2;
  const baseVariance = (n1 * n2 * (N + 1)) / 12;
  const adjustedVariance = baseVariance - tieCorrection * (n1 * n2 / (N * (N - 1)));
  const sigmaU = Math.sqrt(adjustedVariance);
  
  // Apply continuity correction for better normal approximation
  const continuityCorrection = 0.5 * Math.sign(U - meanU);
  const z = (U - meanU - continuityCorrection) / sigmaU;
  
  // Two-tailed p-value with more accurate extreme value handling
  let pValue;
  if (Math.abs(z) > 6) {
    // For extreme z values, avoid potential underflow/precision issues
    pValue = 2 * Math.exp(-0.5 * z * z) / (Math.abs(z) * Math.sqrt(2 * Math.PI));
  } else {
    pValue = 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1));
  }
  
  // Calculate effect size r = Z / sqrt(N) - more reliable than U-based metrics for large samples
  const effectSize = z / Math.sqrt(N);
  
  // Calculate medians and IQR for reporting
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  
  const medianA = calculatePercentile(sortedA, 50);
  const medianB = calculatePercentile(sortedB, 50);
  const iqrA = calculatePercentile(sortedA, 75) - calculatePercentile(sortedA, 25);
  const iqrB = calculatePercentile(sortedB, 75) - calculatePercentile(sortedB, 25);
  
  // Determine which group has higher values
  const higherGroup = rankSumA / n1 > rankSumB / n2 ? 'A' : 'B';
  
  // Calculate common language effect size - probability that a random value from one group exceeds a random value from the other
  const clEffect = (U1 / (n1 * n2)) * 100;
  
  resultsDiv.innerHTML += `
    <p><strong>Mann-Whitney U Test (Wilcoxon Rank-Sum)</strong><br/>
    Dataset A: n = ${n1}, Median = ${medianA.toFixed(4)}, IQR = ${iqrA.toFixed(4)}<br/>
    Dataset B: n = ${n2}, Median = ${medianB.toFixed(4)}, IQR = ${iqrB.toFixed(4)}<br/>
    U = ${U.toFixed(2)}, z = ${z.toFixed(4)}, p-value = ${pValue.toFixed(6)}<br/>
    Effect Size (r) = ${effectSize.toFixed(4)}<br/>
    Common Language Effect Size = ${clEffect.toFixed(1)}% (probability that a random frame from dataset ${higherGroup} has ${higherGroup === 'A' ? 'lower' : 'higher'} frametime)<br/>
    Dataset ${higherGroup} appears to have ${Math.abs(pValue) <= 0.05 ? '<strong>significantly</strong>' : 'not significantly'} ${higherGroup === 'A' ? 'higher' : 'lower'} frametimes</p>
  `;
  
  return { 
    U, z, pValue, effectSize, 
    medianA, medianB, 
    iqrA, iqrB,
    higherGroup,
    clEffect,
    n1, n2
  };
}

/**
 * Enhanced Kolmogorov-Smirnov test optimized for large frametime datasets.
 * Includes bootstrap confidence intervals and adaptive sampling for very large sets.
 */
function runKolmogorovSmirnovTest(a, b, resultsDiv) {
  const n1 = a.length;
  const n2 = b.length;
  
  if (n1 < 5 || n2 < 5) {
    resultsDiv.innerHTML += '<p>K-S test works best with at least 5 data points per group.</p>';
    if (n1 < 1 || n2 < 1) return null;
  }
  
  // For extremely large datasets, use adaptive sampling to improve performance
  // while maintaining accuracy of the test statistic
  let aSubset = a;
  let bSubset = b;
  let samplingApplied = false;
  
  if (n1 > 10000 || n2 > 10000) {
    samplingApplied = true;
    const sampleSize = 5000; // Still large enough for accurate results
    
    if (n1 > 10000) {
      // Systematic sampling preserves distribution better than random
      const step = Math.floor(n1 / sampleSize);
      aSubset = Array(sampleSize);
      for (let i = 0; i < sampleSize; i++) {
        aSubset[i] = a[i * step];
      }
    }
    
    if (n2 > 10000) {
      const step = Math.floor(n2 / sampleSize);
      bSubset = Array(sampleSize);
      for (let i = 0; i < sampleSize; i++) {
        bSubset[i] = b[i * step];
      }
    }
  }
  
  // Step 1: Sort both arrays
  const sortedA = [...aSubset].sort((x, y) => x - y);
  const sortedB = [...bSubset].sort((x, y) => x - y);
  
  // Step 2: Create empirical cumulative distribution functions (ECDF)
  const ecdfA = createECDF(sortedA);
  const ecdfB = createECDF(sortedB);
  
  // Step 3: Find the maximum difference between the two ECDFs
  // Optimization: evaluate at all points from both sets (optimal approach)
  let maxDiff = 0;
  let maxDiffValue = 0;
  
  // Create a merged, sorted array of all unique values from both datasets
  const uniqueA = new Set(sortedA);
  const uniqueB = new Set(sortedB);
  const uniqueValues = new Set([...uniqueA, ...uniqueB]);
  const combinedValues = [...uniqueValues].sort((a, b) => a - b);
  
  for (const value of combinedValues) {
    const fa = ecdfA(value);
    const fb = ecdfB(value);
    const diff = Math.abs(fa - fb);
    if (diff > maxDiff) {
      maxDiff = diff;
      maxDiffValue = value;
    }
  }
  
  // Step 4: Calculate the K-S statistic (D)
  const D = maxDiff;
  
  // Step 5: Calculate the p-value (using improved asymptotic distribution)
  const c = Math.sqrt((n1 * n2) / (n1 + n2));
  const z = D * c;
  
  // Improved p-value calculation for large samples
  let pValue;
  if (z < 1.18) {
    const y = Math.exp(-Math.PI * Math.PI / (8 * z * z));
    pValue = 1 - 2 * (y + Math.pow(y, 9) + Math.pow(y, 25) + Math.pow(y, 49));
  } else {
    // For larger z values, compute a more accurate p-value
    pValue = 2 * Math.exp(-2 * z * z);
  }
  
  // For very small p-values, ensure we don't hit floating point limits
  if (pValue < 1e-15) {
    pValue = 1e-15;
  }
  
  // Calculate effect size - D itself is the effect size
  const effectSize = D;
  
  // Generate a bootstrap confidence interval for D (perform if requested in UI)
  let ciLower = null;
  let ciUpper = null;
  
  // Calculate measures of distribution shapes
  const medianA = calculatePercentile(sortedA, 50);
  const medianB = calculatePercentile(sortedB, 50);
  const iqrA = calculatePercentile(sortedA, 75) - calculatePercentile(sortedA, 25);
  const iqrB = calculatePercentile(sortedB, 75) - calculatePercentile(sortedB, 25);
  
  // Distribution difference analysis
  const distributionDiffText = `The largest difference occurs at value ${maxDiffValue.toFixed(4)}`;
  
  // Test for distribution shape differences (skewness, etc.)
  const skewA = calculateSkewness(sortedA);
  const skewB = calculateSkewness(sortedB);
  const skewDiff = Math.abs(skewA - skewB);
  
  let shapeDiffText = "";
  if (skewDiff > 0.5) {
    shapeDiffText = `<br>The distributions differ significantly in shape (skewness difference: ${skewDiff.toFixed(2)})`;
    if (skewA > skewB) {
      shapeDiffText += `. Dataset A has more extreme high values.`;
    } else {
      shapeDiffText += `. Dataset B has more extreme high values.`;
    }
  }
  
  const samplingNote = samplingApplied ? 
    `<br>Note: Sampling was applied to handle large dataset size (original sizes: A=${n1}, B=${n2})` : "";
  
  resultsDiv.innerHTML += `
    <p><strong>Kolmogorov-Smirnov Test</strong><br/>
    Dataset A: n = ${samplingApplied ? aSubset.length : n1}, Median = ${medianA.toFixed(4)}, IQR = ${iqrA.toFixed(4)}<br/>
    Dataset B: n = ${samplingApplied ? bSubset.length : n2}, Median = ${medianB.toFixed(4)}, IQR = ${iqrB.toFixed(4)}<br/>
    D = ${D.toFixed(4)}, p-value = ${pValue.toFixed(6)}<br/>
    Effect Size (D) = ${effectSize.toFixed(4)}<br/>
    ${distributionDiffText}${shapeDiffText}${samplingNote}<br/>
    The distributions are ${pValue <= 0.05 ? '<strong>significantly different</strong>' : '<strong>not significantly different</strong>'}</p>
  `;
  
  return { 
    D, pValue, effectSize,
    medianA, medianB,
    iqrA, iqrB,
    maxDiffValue,
    skewA, skewB,
    n1: samplingApplied ? aSubset.length : n1, 
    n2: samplingApplied ? bSubset.length : n2
  };
}

/**
 * Calculate skewness of a distribution (sorted array).
 * Positive skew means tail on right, negative means tail on left.
 */
function calculateSkewness(sortedArr) {
  const n = sortedArr.length;
  if (n < 3) return 0;
  
  const mean = sortedArr.reduce((sum, val) => sum + val, 0) / n;
  
  let m2 = 0; // second moment (variance)
  let m3 = 0; // third moment (for skewness)
  
  for (const val of sortedArr) {
    const dev = val - mean;
    m2 += dev * dev;
    m3 += dev * dev * dev;
  }
  
  m2 /= n;
  m3 /= n;
  
  if (m2 === 0) return 0; // Avoid division by zero
  return m3 / Math.pow(m2, 1.5);
}

/**
 * Helper function to create an empirical cumulative distribution function (ECDF)
 * Returns a function that gives the proportion of data points <= x
 */
function createECDF(sortedData) {
  const n = sortedData.length;
  
  return function(x) {
    if (x < sortedData[0]) return 0;
    if (x >= sortedData[n - 1]) return 1;
    
    // Binary search to find position
    let left = 0;
    let right = n - 1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if (sortedData[mid] <= x) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    
    return left / n;
  };
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
  
  const direction = cohenD > 0 ? "higher" : "lower";
  
  interpDiv.innerHTML = `
    <p><strong>Interpretation:</strong> The effect size (Cohen's d = ${cohenD.toFixed(2)}) indicates a 
    <span class="${effectSizeClass} effect-size-indicator">${effectSizeText}</span> effect.</p>
    
    <p>Dataset B has ${direction} values than Dataset A with a ${effectSizeText} practical significance.</p>
    
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

/**
 * Interprets the Mann-Whitney test effect size and adds text to #testInterpretation.
 */
function interpretMannWhitneyResult(effectSize, pValue) {
  const interpDiv = document.getElementById('testInterpretation');
  if (!interpDiv) return;

  const absEffect = Math.abs(effectSize);
  let effectSizeText, effectSizeClass;
  
  if (absEffect < 0.1) {
    effectSizeText = "negligible";
    effectSizeClass = "";
  } else if (absEffect < 0.3) {
    effectSizeText = "small";
    effectSizeClass = "effect-size-small";
  } else if (absEffect < 0.5) {
    effectSizeText = "medium";
    effectSizeClass = "effect-size-medium";
  } else {
    effectSizeText = "large";
    effectSizeClass = "effect-size-large";
  }
  
  const significanceText = pValue <= 0.05 ? 
    "The distributions are <strong>significantly different</strong>" :
    "The distributions are <strong>not significantly different</strong>";
  
  interpDiv.innerHTML = `
    <p><strong>Interpretation:</strong> The effect size (r = ${effectSize.toFixed(2)}) indicates a 
    <span class="${effectSizeClass} effect-size-indicator">${effectSizeText}</span> difference between distributions.</p>
    
    <p>${significanceText} (p = ${pValue.toFixed(6)}, α = 0.05).</p>
    
    <p>Guidelines for Mann-Whitney effect size interpretation:</p>
    <ul>
      <li>|r| < 0.1: Negligible difference</li>
      <li>0.1 ≤ |r| < 0.3: Small difference</li>
      <li>0.3 ≤ |r| < 0.5: Medium difference</li>
      <li>|r| ≥ 0.5: Large difference</li>
    </ul>
    
    <p>This test examines whether values in one dataset tend to be larger than values in the other,
    without making assumptions about the distribution (like normality).</p>
  `;
}

/**
 * Interprets the variance test effect size (ln(F)) and adds text to #testInterpretation.
 */
function interpretVarianceTest(effectSize, pValue) {
  const interpDiv = document.getElementById('testInterpretation');
  if (!interpDiv) return;

  const absEffect = Math.abs(effectSize);
  let effectSizeText, effectSizeClass;
  
  if (absEffect < 0.5) {
    effectSizeText = "negligible";
    effectSizeClass = "";
  } else if (absEffect < 1.0) {
    effectSizeText = "small";
    effectSizeClass = "effect-size-small";
  } else if (absEffect < 1.5) {
    effectSizeText = "medium";
    effectSizeClass = "effect-size-medium";
  } else {
    effectSizeText = "large";
    effectSizeClass = "effect-size-large";
  }
  
  const significanceText = pValue <= 0.05 ? 
    "The variances are <strong>significantly different</strong>" :
    "The variances are <strong>not significantly different</strong>";
  
  interpDiv.innerHTML = `
    <p><strong>Interpretation:</strong> The effect size (ln(F) = ${effectSize.toFixed(2)}) indicates a 
    <span class="${effectSizeClass} effect-size-indicator">${effectSizeText}</span> difference in variance.</p>
    
    <p>${significanceText} (p = ${pValue.toFixed(6)}, α = 0.05).</p>
    
    <p>Guidelines for variance effect size interpretation:</p>
    <ul>
      <li>ln(F) < 0.5: Negligible difference</li>
      <li>0.5 ≤ ln(F) < 1.0: Small difference</li>
      <li>1.0 ≤ ln(F) < 1.5: Medium difference</li>
      <li>ln(F) ≥ 1.5: Large difference</li>
    </ul>
    
    <p>The natural log of F (ln(F)) is used as the effect size measure because variance ratios
    can become arbitrarily large, while ln(F) provides a more balanced scale.</p>
  `;
}

/**
 * Interprets the frame pacing results with consistent formatting.
 */
function interpretFramePacingResult(consistencyDiff) {
  const interpDiv = document.getElementById('testInterpretation');
  if (!interpDiv) return;
  
  let effectSizeText, effectSizeClass;
  const absDiff = Math.abs(consistencyDiff);
  
  if (absDiff < 2) {
    effectSizeText = "negligible";
    effectSizeClass = "";
  } else if (absDiff < 5) {
    effectSizeText = "small";
    effectSizeClass = "effect-size-small";
  } else if (absDiff < 10) {
    effectSizeText = "medium";
    effectSizeClass = "effect-size-medium";
  } else {
    effectSizeText = "large";
    effectSizeClass = "effect-size-large";
  }
  
  let assessmentText;
  if (consistencyDiff > 5) {
    assessmentText = "significant improvement";
  } else if (consistencyDiff > 2) {
    assessmentText = "moderate improvement";
  } else if (consistencyDiff > 0) {
    assessmentText = "slight improvement";
  } else if (consistencyDiff > -2) {
    assessmentText = "negligible change";
  } else {
    assessmentText = "degradation";
  }
  
  interpDiv.innerHTML = `
    <p><strong>Interpretation:</strong> The difference in frame pacing consistency (${consistencyDiff.toFixed(2)}%) indicates a
    <span class="${effectSizeClass} effect-size-indicator">${effectSizeText}</span> effect.</p>
    
    <p>Dataset B shows a <strong>${assessmentText}</strong> in frame pacing compared to Dataset A.</p>
    
    <p>Guidelines for frame pacing difference interpretation:</p>
    <ul>
      <li>|diff| < 2%: Negligible difference</li>
      <li>2% ≤ |diff| < 5%: Small difference</li>
      <li>5% ≤ |diff| < 10%: Medium difference</li>
      <li>|diff| ≥ 10%: Large difference</li>
    </ul>
  `;
}

/**
 * Interprets the Kolmogorov-Smirnov test result and adds text to #testInterpretation.
 */
function interpretKSTestResult(effectSize, pValue, skewA, skewB, maxDiffValue) {
  const interpDiv = document.getElementById('testInterpretation');
  if (!interpDiv) return;

  let effectSizeText, effectSizeClass;
  
  if (effectSize < 0.15) {
    effectSizeText = "negligible";
    effectSizeClass = "";
  } else if (effectSize < 0.3) {
    effectSizeText = "small";
    effectSizeClass = "effect-size-small";
  } else if (effectSize < 0.5) {
    effectSizeText = "medium";
    effectSizeClass = "effect-size-medium";
  } else {
    effectSizeText = "large";
    effectSizeClass = "effect-size-large";
  }
  
  const significanceText = pValue <= 0.05 ? 
    "The frame time distributions are <strong>significantly different</strong>" :
    "The frame time distributions are <strong>not significantly different</strong>";
  
  // Provide more specific insights about the nature of the difference
  let distributionInsight = "";
  const skewDiff = skewA - skewB;
  
  if (Math.abs(skewDiff) > 0.3) {
    if (skewDiff > 0) {
      distributionInsight = `Dataset A has more high frame time spikes (right-skewed) compared to Dataset B.`;
    } else {
      distributionInsight = `Dataset B has more high frame time spikes (right-skewed) compared to Dataset A.`;
    }
  }
  
  interpDiv.innerHTML = `
    <p><strong>Interpretation:</strong> The effect size (D = ${effectSize.toFixed(2)}) indicates a 
    <span class="${effectSizeClass} effect-size-indicator">${effectSizeText}</span> difference between frame time distributions.</p>
    
    <p>${significanceText} (p = ${pValue.toFixed(6)}, α = 0.05).</p>
    
    <p>The maximum difference between distributions occurs at ${maxDiffValue.toFixed(2)}ms. 
    ${distributionInsight}</p>
    
    <p><strong>What This Means:</strong> ${getKSMeaning(effectSize, pValue, skewDiff)}</p>
    
    <p>Guidelines for Kolmogorov-Smirnov effect size interpretation:</p>
    <ul>
      <li>D < 0.15: Negligible difference</li>
      <li>0.15 ≤ D < 0.3: Small difference</li>
      <li>0.3 ≤ D < 0.5: Medium difference</li>
      <li>D ≥ 0.5: Large difference</li>
    </ul>
  `;
}

/**
 * Provides a user-friendly interpretation of KS test results specifically 
 * for frame time data.
 */
function getKSMeaning(effectSize, pValue, skewDiff) {
  if (pValue > 0.05) {
    return "There is no strong evidence that the two frame time distributions differ. " +
           "Users would likely not perceive a difference in smoothness between these two conditions.";
  }
  
  if (effectSize < 0.15) {
    return "Although statistically significant with this large sample size, the actual difference " +
           "between frame time distributions is tiny and would not be noticeable to users.";
  }
  
  if (effectSize < 0.3) {
    return "There is a small but real difference between frame time distributions. " +
           "Very sensitive users might perceive a slight difference in smoothness, but most would not notice.";
  }
  
  let baseText = "There is a substantial difference between frame time distributions. " +
                "Most users would likely notice a difference in perceived smoothness.";
  
  if (Math.abs(skewDiff) > 0.3) {
    if (skewDiff > 0) {
      baseText += " Dataset A exhibits more frame time spikes, which typically results in a less smooth experience.";
    } else {
      baseText += " Dataset B exhibits more frame time spikes, which typically results in a less smooth experience.";
    }
  }
  
  return baseText;
}

/**
 * Performs additional advanced frame time diagnostics beyond basic statistical tests.
 * Identifies patterns like multi-modality, clustering, and stuttering.
 */
function runFrameTimeDiagnostics(a, b, resultsDiv) {
  // Skip if either dataset is empty
  if (!a.length || !b.length) return null;
  
  const diagnostics = {
    a: analyzeDistributionCharacteristics(a),
    b: analyzeDistributionCharacteristics(b)
  };
  
  resultsDiv.innerHTML += `
    <p><strong>Advanced Frame Time Diagnostics</strong></p>
    <div class="diagnostic-comparison">
      <div class="diagnostic-column">
        <h4>Dataset A:</h4>
        <ul>
          <li>Mean: ${diagnostics.a.mean.toFixed(2)}ms</li>
          <li>Median: ${diagnostics.a.median.toFixed(2)}ms</li>
          <li>Variance: ${diagnostics.a.variance.toFixed(4)}</li>
          <li>Skewness: ${diagnostics.a.skewness.toFixed(2)} ${interpretSkewness(diagnostics.a.skewness)}</li>
          <li>Multi-modality: ${diagnostics.a.isMultimodal ? 'Detected' : 'Not detected'}</li>
          <li>Outlier percentage: ${diagnostics.a.outlierPercentage.toFixed(2)}%</li>
          <li>Stutter risk: ${interpretStutterRisk(diagnostics.a)}</li>
        </ul>
      </div>
      
      <div class="diagnostic-column">
        <h4>Dataset B:</h4>
        <ul>
          <li>Mean: ${diagnostics.b.mean.toFixed(2)}ms</li>
          <li>Median: ${diagnostics.b.median.toFixed(2)}ms</li>
          <li>Variance: ${diagnostics.b.variance.toFixed(4)}</li>
          <li>Skewness: ${diagnostics.b.skewness.toFixed(2)} ${interpretSkewness(diagnostics.b.skewness)}</li>
          <li>Multi-modality: ${diagnostics.b.isMultimodal ? 'Detected' : 'Not detected'}</li>
          <li>Outlier percentage: ${diagnostics.b.outlierPercentage.toFixed(2)}%</li>
          <li>Stutter risk: ${interpretStutterRisk(diagnostics.b)}</li>
        </ul>
      </div>
    </div>
    
    <p><strong>Comparative Verdict:</strong> ${getComparativeVerdict(diagnostics.a, diagnostics.b)}</p>
  `;
  
  return diagnostics;
}

/**
 * Analyzes a frame time distribution for various characteristics important
 * for understanding gaming performance.
 */
function analyzeDistributionCharacteristics(data) {
  const n = data.length;
  if (n < 10) return null;
  
  const sorted = [...data].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, val) => sum + val, 0) / n;
  const median = calculatePercentile(sorted, 50);
  
  // Calculate variance
  const variance = sorted.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
  
  // Calculate skewness
  const skewness = calculateSkewness(sorted);
  
  // Detect outliers (values > 1.5 IQR from quartiles)
  const q1 = calculatePercentile(sorted, 25);
  const q3 = calculatePercentile(sorted, 75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  
  let outlierCount = 0;
  for (const val of sorted) {
    if (val < lowerFence || val > upperFence) {
      outlierCount++;
    }
  }
  
  const outlierPercentage = (outlierCount / n) * 100;
  
  // Simple multi-modality detection using kernel density estimation
  // Note: A full KDE implementation would be more accurate but also more complex
  // This is a simplified approach that looks for "valleys" in the histogram
  const isMultimodal = detectMultimodality(sorted);
  
  // Calculate additional frame pacing metrics
  const diffs = [];
  for (let i = 1; i < data.length; i++) {
    diffs.push(Math.abs(data[i] - data[i - 1]));
  }
  
  const diffMedian = calculatePercentile([...diffs].sort((a, b) => a - b), 50);
  const diffVariance = diffs.reduce((sum, val) => sum + Math.pow(val - diffMedian, 2), 0) / diffs.length;
  
  // Detect problematic transition frequencies (variability in frame pacing)
  const transitionVariability = Math.sqrt(diffVariance) / diffMedian;
  
  return {
    mean,
    median,
    variance,
    skewness,
    outlierPercentage,
    isMultimodal,
    diffMedian,
    diffVariance,
    transitionVariability
  };
}

/**
 * Detects if a distribution appears to be multi-modal (simplified approach).
 */
function detectMultimodality(sortedData) {
  const n = sortedData.length;
  if (n < 50) return false; // Not enough data for reliable detection
  
  // Create histogram bins
  const min = sortedData[0];
  const max = sortedData[n-1];
  const range = max - min;
  
  // Use Sturges' formula to determine bin count
  const binCount = Math.ceil(Math.log2(n) + 1);
  const binWidth = range / binCount;
  
  // Count items in each bin
  const bins = new Array(binCount).fill(0);
  for (const val of sortedData) {
    const binIndex = Math.min(binCount - 1, Math.floor((val - min) / binWidth));
    bins[binIndex]++;
  }
  
  // Detect valleys between peaks
  let peakCount = 0;
  let rising = false;
  
  for (let i = 1; i < binCount; i++) {
    if (!rising && bins[i] > bins[i-1]) {
      rising = true;
    } else if (rising && bins[i] < bins[i-1]) {
      peakCount++;
      rising = false;
    }
  }
  
  // If we end on a rise, count the final peak
  if (rising) {
    peakCount++;
  }
  
  return peakCount > 1;
}

/**
 * Interprets skewness value into user-friendly text
 */
function interpretSkewness(skewness) {
  if (skewness > 1) {
    return "(highly right-skewed, many frame spikes)";
  } else if (skewness > 0.5) {
    return "(moderately right-skewed, some frame spikes)";
  } else if (skewness > 0.2) {
    return "(slightly right-skewed)";
  } else if (skewness < -1) {
    return "(highly left-skewed, unusual for frame times)";
  } else if (skewness < -0.5) {
    return "(moderately left-skewed, unusual for frame times)";
  } else if (skewness < -0.2) {
    return "(slightly left-skewed)";
  } else {
    return "(approximately symmetric)";
  }
}

/**
 * Interprets stutter risk from distribution characteristics
 */
function interpretStutterRisk(diagnostics) {
  // Higher values indicate more stutter risk
  const riskScore = 
    (diagnostics.skewness > 0.5 ? 2 : diagnostics.skewness > 0.2 ? 1 : 0) + // Skewness contribution
    (diagnostics.outlierPercentage > 1 ? 2 : diagnostics.outlierPercentage > 0.5 ? 1 : 0) + // Outlier contribution
    (diagnostics.isMultimodal ? 1 : 0) + // Multi-modality contribution
    (diagnostics.transitionVariability > 0.3 ? 2 : diagnostics.transitionVariability > 0.1 ? 1 : 0); // Frame pacing contribution
  
  if (riskScore >= 5) {
    return "High";
  } else if (riskScore >= 3) {
    return "Medium";
  } else if (riskScore >= 1) {
    return "Low";
  } else {
    return "Very Low";
  }
}

/**
 * Generates a comparative verdict between two datasets
 */
function getComparativeVerdict(diagA, diagB) {
  // Compare mean/median
  const lowerFrametimeBetter = diagA.median < diagB.median;
  const medianDiffPercent = Math.abs(diagA.median - diagB.median) / Math.min(diagA.median, diagB.median) * 100;
  
  // Compare stutter risks (inferred from diagnostics)
  const stutterRiskA = 
    (diagA.skewness > 0.5 ? 2 : diagA.skewness > 0.2 ? 1 : 0) + 
    (diagA.outlierPercentage > 1 ? 2 : diagA.outlierPercentage > 0.5 ? 1 : 0) +
    (diagA.isMultimodal ? 1 : 0) +
    (diagA.transitionVariability > 0.3 ? 2 : diagA.transitionVariability > 0.1 ? 1 : 0);
  
  const stutterRiskB = 
    (diagB.skewness > 0.5 ? 2 : diagB.skewness > 0.2 ? 1 : 0) + 
    (diagB.outlierPercentage > 1 ? 2 : diagB.outlierPercentage > 0.5 ? 1 : 0) +
    (diagB.isMultimodal ? 1 : 0) +
    (diagB.transitionVariability > 0.3 ? 2 : diagB.transitionVariability > 0.1 ? 1 : 0);
  
  const lowerStutterRisk = stutterRiskA < stutterRiskB;
  
  // Generate verdict
  if (medianDiffPercent < 2 && Math.abs(stutterRiskA - stutterRiskB) <= 1) {
    return "The two datasets show very similar performance characteristics with no meaningful differences in typical frametime or smoothness.";
  }
  
  // Determine which dataset is generally better
  let betterDataset = "";
  if (lowerFrametimeBetter && lowerStutterRisk) {
    betterDataset = "Dataset A appears superior with both lower frametimes and better smoothness.";
  } else if (!lowerFrametimeBetter && !lowerStutterRisk) {
    betterDataset = "Dataset B appears superior with both lower frametimes and better smoothness.";
  } else if (lowerFrametimeBetter && !lowerStutterRisk) {
    betterDataset = "Dataset A has lower average frametimes, but Dataset B shows better smoothness.";
  } else {
    betterDataset = "Dataset B has lower average frametimes, but Dataset A shows better smoothness.";
  }
  
  // Add specific details about the magnitude of differences
  let details = "";
  if (medianDiffPercent >= 5) {
    details += ` There is a substantial difference in typical frametime (${medianDiffPercent.toFixed(1)}%).`;
  } else if (medianDiffPercent >= 2) {
    details += ` There is a noticeable difference in typical frametime (${medianDiffPercent.toFixed(1)}%).`;
  }
  
  if (Math.abs(stutterRiskA - stutterRiskB) >= 3) {
    details += ` There is a major difference in smoothness characteristics.`;
  } else if (Math.abs(stutterRiskA - stutterRiskB) >= 2) {
    details += ` There is a meaningful difference in smoothness characteristics.`;
  }
  
  return betterDataset + details;
}

/**
 * Performs bootstrap resampling to estimate confidence intervals for various statistics.
 * This provides a robust way to quantify uncertainty in our metrics.
 * 
 * @param {number[]} data - Array of frame time values
 * @param {function} statFunc - Function that calculates the statistic of interest
 * @param {number} iterations - Number of bootstrap iterations (default: 1000)
 * @param {number} confidenceLevel - Confidence level (default: 0.95 for 95% CI)
 * @returns {{lower: number, upper: number, mean: number}} The CI bounds and mean
 */
function bootstrapConfidenceInterval(data, statFunc, iterations = 1000, confidenceLevel = 0.95) {
  if (!data || data.length < 10) {
    return { lower: NaN, upper: NaN, mean: NaN };
  }
  
  // Calculate the original statistic
  const originalStat = statFunc(data);
  
  // Array to store bootstrap samples
  const bootStats = new Array(iterations);
  const n = data.length;
  
  // Perform bootstrap resampling
  for (let i = 0; i < iterations; i++) {
    // Create a bootstrap sample with replacement
    const bootSample = new Array(n);
    for (let j = 0; j < n; j++) {
      const randomIndex = Math.floor(Math.random() * n);
      bootSample[j] = data[randomIndex];
    }
    
    // Calculate the statistic for this bootstrap sample
    bootStats[i] = statFunc(bootSample);
  }
  
  // Sort bootstrap statistics
  bootStats.sort((a, b) => a - b);
  
  // Calculate CI bounds
  const alpha = 1 - confidenceLevel;
  const lowerIndex = Math.floor(iterations * (alpha / 2));
  const upperIndex = Math.floor(iterations * (1 - alpha / 2));
  
  return {
    lower: bootStats[lowerIndex],
    upper: bootStats[upperIndex],
    mean: originalStat
  };
}

/**
 * Creates a bootstrap confidence interval visualization and adds it to the results.
 * Shows uncertainty in frame time statistics for more robust interpretation.
 * 
 * @param {number[]} dataA - First dataset
 * @param {number[]} dataB - Second dataset
 * @param {HTMLElement} resultsDiv - Element to append the visualization to
 */
function visualizeBootstrapCI(dataA, dataB, resultsDiv) {
  // Skip if data is too small
  if (!dataA || !dataB || dataA.length < 10 || dataB.length < 10) {
    resultsDiv.innerHTML += '<p>Insufficient data for bootstrap confidence intervals.</p>';
    return;
  }
  
  // Calculate bootstrap CIs for various metrics
  const metrics = [
    { 
      name: 'Median', 
      func: data => calculatePercentile([...data].sort((a, b) => a - b), 50),
      unit: 'ms'
    },
    { 
      name: '1% Low', 
      func: data => {
        const sorted = [...data].sort((a, b) => a - b);
        const p1Index = Math.floor(sorted.length * 0.01);
        const p1Count = Math.max(1, Math.ceil(sorted.length * 0.01));
        let sum = 0;
        for (let i = 0; i < p1Count; i++) {
          sum += sorted[i];
        }
        return sum / p1Count;
      },
      unit: 'ms'
    },
    { 
      name: 'Frame Pacing Consistency', 
      func: data => analyzeFramePacing(data).consistency,
      unit: '%'
    }
  ];
  
  // Set up the visualization container
  resultsDiv.innerHTML += `
    <div class="bootstrap-visualization">
      <h4>Bootstrap Confidence Intervals (95%)</h4>
      <p>These intervals show the range of plausible values for each metric, accounting for sampling variability.</p>
      <div id="bootstrapCIContainer" class="ci-container"></div>
    </div>
  `;
  
  const ciContainer = document.getElementById('bootstrapCIContainer');
  if (!ciContainer) return;
  
  // Calculate and display CIs for each metric
  const ciResults = [];
  metrics.forEach(metric => {
    const ciA = bootstrapConfidenceInterval(dataA, metric.func);
    const ciB = bootstrapConfidenceInterval(dataB, metric.func);
    
    ciResults.push({
      metric: metric.name,
      unit: metric.unit,
      datasetA: ciA,
      datasetB: ciB
    });
    
    // Add to the container
    const ciRow = document.createElement('div');
    ciRow.className = 'ci-row';
    
    // Create the HTML content with improved layout
    ciRow.innerHTML = `
      <div class="ci-label">${metric.name}:</div>
      <div class="ci-bars">
        <div class="ci-bar-container">
          <div class="ci-label-small">Dataset A:</div>
          <div class="ci-bar">
            <div class="ci-range-labels">
              <span class="ci-lower-label">${ciA.lower.toFixed(2)}${metric.unit}</span>
              <span class="ci-mean-label">${ciA.mean.toFixed(2)}${metric.unit}</span>
              <span class="ci-upper-label">${ciA.upper.toFixed(2)}${metric.unit}</span>
            </div>
            <div class="ci-bar-inner">
              <div class="ci-range-line"></div>
              <div class="ci-mean-marker" style="left: ${(ciA.mean - ciA.lower) / (ciA.upper - ciA.lower) * 100}%;"></div>
            </div>
          </div>
        </div>
        <div class="ci-bar-container">
          <div class="ci-label-small">Dataset B:</div>
          <div class="ci-bar">
            <div class="ci-range-labels">
              <span class="ci-lower-label">${ciB.lower.toFixed(2)}${metric.unit}</span>
              <span class="ci-mean-label">${ciB.mean.toFixed(2)}${metric.unit}</span>
              <span class="ci-upper-label">${ciB.upper.toFixed(2)}${metric.unit}</span>
            </div>
            <div class="ci-bar-inner">
              <div class="ci-range-line"></div>
              <div class="ci-mean-marker" style="left: ${(ciB.mean - ciB.lower) / (ciB.upper - ciB.lower) * 100}%;"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    ciContainer.appendChild(ciRow);
  });
  
  // Add interpretation of the bootstrapping results
  const interpretation = interpretBootstrapResults(ciResults);
  resultsDiv.innerHTML += `
    <div class="bootstrap-interpretation">
      <h4>Interpretation of Confidence Intervals</h4>
      <p>${interpretation}</p>
    </div>
  `;
}

/**
 * Interprets the bootstrap confidence interval results to provide meaningful insights.
 * 
 * @param {Array} ciResults - Array of CI results for different metrics
 * @returns {string} Human-readable interpretation
 */
function interpretBootstrapResults(ciResults) {
  if (!ciResults || ciResults.length === 0) {
    return "No confidence interval data available.";
  }
  
  let interpretation = "Based on the bootstrap analysis:";
  
  ciResults.forEach(result => {
    const { metric, unit, datasetA, datasetB } = result;
    
    // Check if CIs overlap
    const overlapping = 
      (datasetA.lower <= datasetB.upper && datasetA.upper >= datasetB.lower) ||
      (datasetB.lower <= datasetA.upper && datasetB.upper >= datasetA.lower);
    
    if (overlapping) {
      interpretation += `<br>• The ${metric} measurements show overlapping confidence intervals, suggesting the difference between datasets may not be reliable.`;
    } else {
      const better = metric === 'Frame Pacing Consistency' ? 
        (datasetA.lower > datasetB.upper ? 'A' : 'B') :
        (datasetA.upper < datasetB.lower ? 'A' : 'B');
      
      interpretation += `<br>• The ${metric} is reliably ${better === 'A' ? 'better in Dataset A' : 'better in Dataset B'} (non-overlapping CIs).`;
    }
    
    // Comment on width of CI (precision)
    const widthA = datasetA.upper - datasetA.lower;
    const widthB = datasetB.upper - datasetB.lower;
    const relWidthA = widthA / datasetA.mean;
    const relWidthB = widthB / datasetB.mean;
    
    if (Math.max(relWidthA, relWidthB) > 0.2) {
      interpretation += ` The wide confidence intervals suggest high variability in the data.`;
    }
  });
  
  return interpretation;
}

/**
 * Creates a frame time stability visualization showing transitions between consecutive frames.
 * This helps identify patterns in frame pacing and stuttering.
 * 
 * @param {number[]} dataA - First dataset frametime values
 * @param {number[]} dataB - Second dataset frametime values
 * @param {HTMLElement} resultsDiv - Element to append the visualization to
 */
function visualizeFrameTimeStability(dataA, dataB, resultsDiv) {
  // Skip if data is too small
  if (!dataA || !dataB || dataA.length < 10 || dataB.length < 10) {
    resultsDiv.innerHTML += '<p>Insufficient data for frame stability visualization.</p>';
    return;
  }
  
  // Calculate transition data (differences between consecutive frames)
  const transitionsA = calculateTransitions(dataA);
  const transitionsB = calculateTransitions(dataB);
  
  // Add container for the visualization
  resultsDiv.innerHTML += `
    <div class="frame-stability-visualization">
      <h4>Frame Time Stability Analysis</h4>
      <p>This visualization shows the transitions between consecutive frames, helping identify stuttering patterns and frame pacing issues.</p>
      
      <div class="stability-container">
        <div class="stability-controls">
          <button id="showTransitionScatterBtn" class="stability-btn active">Transition Scatter</button>
          <button id="showFrameSequenceBtn" class="stability-btn">Frame Sequence</button>
          <button id="showTransitionHistogramBtn" class="stability-btn">Transition Histogram</button>
        </div>
        
        <div class="stability-view-container">
          <canvas id="frameStabilityCanvas" width="800" height="400"></canvas>
        </div>
        
        <div class="stability-stats">
          <div class="stability-stat-column">
            <h5>Dataset A</h5>
            <ul>
              <li>Median transition: ${calculatePercentile([...transitionsA.diffs].sort((a, b) => a - b), 50).toFixed(3)} ms</li>
              <li>Largest transition: ${Math.max(...transitionsA.diffs).toFixed(3)} ms</li>
              <li>Transition variability: ${(calculateStdev(transitionsA.diffs) / calculateMean(transitionsA.diffs)).toFixed(3)}</li>
              <li>Repeated frames: ${transitionsA.repeatedFrames}</li>
              <li>Out-of-sequence frames: ${transitionsA.outOfSequence}</li>
            </ul>
          </div>
          
          <div class="stability-stat-column">
            <h5>Dataset B</h5>
            <ul>
              <li>Median transition: ${calculatePercentile([...transitionsB.diffs].sort((a, b) => a - b), 50).toFixed(3)} ms</li>
              <li>Largest transition: ${Math.max(...transitionsB.diffs).toFixed(3)} ms</li>
              <li>Transition variability: ${(calculateStdev(transitionsB.diffs) / calculateMean(transitionsB.diffs)).toFixed(3)}</li>
              <li>Repeated frames: ${transitionsB.repeatedFrames}</li>
              <li>Out-of-sequence frames: ${transitionsB.outOfSequence}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Store the data and view state in global variables for the chart
  window.frameStabilityData = {
    datasetA: {
      original: dataA,
      transitions: transitionsA
    },
    datasetB: {
      original: dataB,
      transitions: transitionsB
    },
    currentView: 'scatter'
  };
  
  // Set up event listeners for the view buttons
  document.getElementById('showTransitionScatterBtn').addEventListener('click', () => {
    setStabilityView('scatter');
  });
  
  document.getElementById('showFrameSequenceBtn').addEventListener('click', () => {
    setStabilityView('sequence');
  });
  
  document.getElementById('showTransitionHistogramBtn').addEventListener('click', () => {
    setStabilityView('histogram');
  });
  
  // Initial render of the stability chart
  renderFrameStabilityVisualization('scatter');
}

/**
 * Calculates transitions between consecutive frames and identifies anomalies.
 * 
 * @param {number[]} data - Array of frame times
 * @returns {Object} Statistics about the transitions
 */
function calculateTransitions(data) {
  if (!data || data.length < 2) {
    return { diffs: [], repeatedFrames: 0, outOfSequence: 0 };
  }
  
  const diffs = [];
  let repeatedFrames = 0;
  let outOfSequence = 0;
  
  // Calculate differences between consecutive frames
  for (let i = 1; i < data.length; i++) {
    const diff = Math.abs(data[i] - data[i-1]);
    diffs.push(diff);
    
    // Count specific patterns
    if (Math.abs(diff) < 0.01) { // Near-zero difference = repeated frame
      repeatedFrames++;
    }
    
    // Potential frame sequence issue (e.g., very large jumps)
    if (diff > 3 * calculatePercentile([...data].sort((a, b) => a - b), 50)) {
      outOfSequence++;
    }
  }
  
  return {
    diffs,
    repeatedFrames,
    outOfSequence,
    original: data
  };
}

/**
 * Changes the current stability visualization and updates the chart.
 * 
 * @param {string} viewType - 'scatter', 'sequence', or 'histogram'
 */
function setStabilityView(viewType) {
  // Update buttons
  document.querySelectorAll('.stability-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  const activeBtn = viewType === 'scatter' ? 'showTransitionScatterBtn' : 
                   viewType === 'sequence' ? 'showFrameSequenceBtn' : 
                   'showTransitionHistogramBtn';
  
  document.getElementById(activeBtn).classList.add('active');
  
  // Update current view and render
  window.frameStabilityData.currentView = viewType;
  renderFrameStabilityVisualization(viewType);
}

/**
 * Renders the frame stability visualization based on the current view type.
 * 
 * @param {string} viewType - 'scatter', 'sequence', or 'histogram'
 */
function renderFrameStabilityVisualization(viewType) {
  const canvas = document.getElementById('frameStabilityCanvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const data = window.frameStabilityData;
  if (!data) return;
  
  switch (viewType) {
    case 'scatter':
      renderTransitionScatter(ctx, canvas, data);
      break;
    case 'sequence':
      renderFrameSequence(ctx, canvas, data);
      break;
    case 'histogram':
      renderTransitionHistogram(ctx, canvas, data);
      break;
  }
}

/**
 * Renders a scatter plot of frame N vs frame N+1 to visualize transition patterns.
 */
function renderTransitionScatter(ctx, canvas, data) {
  const width = canvas.width;
  const height = canvas.height;
  const padding = 40;
  
  // Get all frame time values for scaling
  const allFrameTimes = [
    ...data.datasetA.original,
    ...data.datasetB.original
  ];
  
  const minTime = Math.min(...allFrameTimes) * 0.9;
  const maxTime = Math.max(...allFrameTimes) * 1.1;
  
  // Draw axes
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();
  
  // Draw axis labels
  ctx.fillStyle = '#333';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Frame N', width / 2, height - 10);
  ctx.save();
  ctx.translate(15, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Frame N+1', 0, 0);
  ctx.restore();
  
  // Draw scale
  for (let i = 0; i <= 5; i++) {
    const x = padding + (width - 2 * padding) * i / 5;
    const y = height - padding - (height - 2 * padding) * i / 5;
    const value = minTime + (maxTime - minTime) * i / 5;
    
    // X-axis ticks
    ctx.beginPath();
    ctx.moveTo(x, height - padding);
    ctx.lineTo(x, height - padding + 5);
    ctx.stroke();
    ctx.fillText(value.toFixed(1), x, height - padding + 15);
    
    // Y-axis ticks
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding - 5, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(1), padding - 20, y + 5);
  }
  
  // Draw the diagonal line (perfect pacing)
  ctx.strokeStyle = '#aaa';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, padding);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Plot points for Dataset A
  const dataA = data.datasetA.original;
  ctx.fillStyle = 'rgba(75, 192, 192, 0.7)';
  for (let i = 0; i < dataA.length - 1; i++) {
    const x = padding + (width - 2 * padding) * (dataA[i] - minTime) / (maxTime - minTime);
    const y = height - padding - (height - 2 * padding) * (dataA[i+1] - minTime) / (maxTime - minTime);
    
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Plot points for Dataset B
  const dataB = data.datasetB.original;
  ctx.fillStyle = 'rgba(255, 99, 132, 0.7)';
  for (let i = 0; i < dataB.length - 1; i++) {
    const x = padding + (width - 2 * padding) * (dataB[i] - minTime) / (maxTime - minTime);
    const y = height - padding - (height - 2 * padding) * (dataB[i+1] - minTime) / (maxTime - minTime);
    
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Draw legend
  ctx.fillStyle = 'rgba(75, 192, 192, 1)';
  ctx.fillRect(width - 100, 20, 15, 15);
  ctx.fillStyle = '#333';
  ctx.textAlign = 'left';
  ctx.fillText('Dataset A', width - 80, 32);
  
  ctx.fillStyle = 'rgba(255, 99, 132, 1)';
  ctx.fillRect(width - 100, 45, 15, 15);
  ctx.fillStyle = '#333';
  ctx.fillText('Dataset B', width - 80, 57);
  
  // Add caption
  ctx.textAlign = 'center';
  ctx.fillText('Frame-to-Frame Transitions (closer to diagonal = better pacing)', width / 2, 20);
}

/**
 * Renders a sequence plot of consecutive frame times to visualize pacing over time.
 */
function renderFrameSequence(ctx, canvas, data) {
  const width = canvas.width;
  const height = canvas.height;
  const padding = 40;
  
  // Number of frames to show (capped to keep visualization readable)
  const maxFramesToShow = 200;
  
  // Get frame time sequences for both datasets
  let dataA = data.datasetA.original.slice(0, maxFramesToShow);
  let dataB = data.datasetB.original.slice(0, maxFramesToShow);
  
  // Get min/max values for scaling
  const allFrameTimes = [...dataA, ...dataB];
  const minTime = Math.min(...allFrameTimes) * 0.9;
  const maxTime = Math.max(...allFrameTimes) * 1.1;
  
  // Draw axes
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();
  
  // Draw axis labels
  ctx.fillStyle = '#333';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Frame Number', width / 2, height - 10);
  ctx.save();
  ctx.translate(15, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Frame Time (ms)', 0, 0);
  ctx.restore();
  
  // Draw Y-axis scale
  for (let i = 0; i <= 5; i++) {
    const y = height - padding - (height - 2 * padding) * i / 5;
    const value = minTime + (maxTime - minTime) * i / 5;
    
    // Y-axis ticks
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding - 5, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(1), padding - 20, y + 5);
  }
  
  // Draw X-axis scale (frame numbers)
  const maxFrames = Math.max(dataA.length, dataB.length);
  for (let i = 0; i <= 5; i++) {
    const x = padding + (width - 2 * padding) * i / 5;
    const frame = Math.floor(maxFrames * i / 5);
    
    // X-axis ticks
    ctx.beginPath();
    ctx.moveTo(x, height - padding);
    ctx.lineTo(x, height - padding + 5);
    ctx.stroke();
    ctx.fillText(frame, x, height - padding + 15);
  }
  
  // Draw target frametime line(s) - assume common framerates
  const commonFramerates = [240, 144, 120, 60, 30];
  const targetFrametimes = commonFramerates.map(fps => 1000 / fps);
  
  ctx.strokeStyle = '#aaa';
  ctx.setLineDash([2, 4]);
  
  targetFrametimes.forEach(target => {
    if (target >= minTime && target <= maxTime) {
      const y = height - padding - (height - 2 * padding) * (target - minTime) / (maxTime - minTime);
      
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      
      // Label the target line
      ctx.fillStyle = '#888';
      ctx.textAlign = 'left';
      ctx.fillText(`${Math.round(1000 / target)} FPS`, width - padding + 5, y + 4);
    }
  });
  
  ctx.setLineDash([]);
  
  // Plot Dataset A
  ctx.strokeStyle = 'rgba(75, 192, 192, 0.9)';
  ctx.lineWidth = 1.5;
  
  ctx.beginPath();
  for (let i = 0; i < dataA.length; i++) {
    const x = padding + (width - 2 * padding) * i / maxFrames;
    const y = height - padding - (height - 2 * padding) * (dataA[i] - minTime) / (maxTime - minTime);
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  
  // Plot Dataset B
  ctx.strokeStyle = 'rgba(255, 99, 132, 0.9)';
  
  ctx.beginPath();
  for (let i = 0; i < dataB.length; i++) {
    const x = padding + (width - 2 * padding) * i / maxFrames;
    const y = height - padding - (height - 2 * padding) * (dataB[i] - minTime) / (maxTime - minTime);
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  
  // Draw legend
  ctx.strokeStyle = 'rgba(75, 192, 192, 1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width - 100, 20);
  ctx.lineTo(width - 85, 20);
  ctx.stroke();
  
  ctx.fillStyle = '#333';
  ctx.textAlign = 'left';
  ctx.fillText('Dataset A', width - 80, 24);
  
  ctx.strokeStyle = 'rgba(255, 99, 132, 1)';
  ctx.beginPath();
  ctx.moveTo(width - 100, 45);
  ctx.lineTo(width - 85, 45);
  ctx.stroke();
  
  ctx.fillStyle = '#333';
  ctx.fillText('Dataset B', width - 80, 49);
  
  // Add caption
  ctx.textAlign = 'center';
  ctx.fillText('Frame Time Sequence (more stable line = better frame pacing)', width / 2, 20);
}

/**
 * Renders a histogram of frame-to-frame transitions to visualize consistency.
 */
function renderTransitionHistogram(ctx, canvas, data) {
  const width = canvas.width;
  const height = canvas.height;
  const padding = 40;
  
  // Get transition data
  const diffsA = data.datasetA.transitions.diffs;
  const diffsB = data.datasetB.transitions.diffs;
  
  // Create histogram bins
  const allDiffs = [...diffsA, ...diffsB];
  const maxDiff = Math.min(Math.max(...allDiffs) * 1.1, calculatePercentile([...allDiffs].sort((a, b) => a - b), 99) * 2);
  const binCount = 20;
  const binWidth = maxDiff / binCount;
  
  const histogramA = new Array(binCount).fill(0);
  const histogramB = new Array(binCount).fill(0);
  
  // Fill histogram bins
  diffsA.forEach(diff => {
    const binIndex = Math.min(binCount - 1, Math.floor(diff / binWidth));
    histogramA[binIndex]++;
  });
  
  diffsB.forEach(diff => {
    const binIndex = Math.min(binCount - 1, Math.floor(diff / binWidth));
    histogramB[binIndex]++;
  });
  
  // Normalize to percentages
  const maxCountA = Math.max(...histogramA) || 1;
  const maxCountB = Math.max(...histogramB) || 1;
  
  for (let i = 0; i < binCount; i++) {
    histogramA[i] = histogramA[i] / diffsA.length * 100;
    histogramB[i] = histogramB[i] / diffsB.length * 100;
  }
  
  const maxPercentage = Math.max(
    Math.max(...histogramA), 
    Math.max(...histogramB)
  );
  
  // Draw axes
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();
  
  // Draw axis labels
  ctx.fillStyle = '#333';
  ctx.font = '12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Frame-to-Frame Transition (ms)', width / 2, height - 10);
  ctx.save();
  ctx.translate(15, height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Percentage of Frames', 0, 0);
  ctx.restore();
  
  // Draw X-axis scale
  for (let i = 0; i <= 5; i++) {
    const x = padding + (width - 2 * padding) * i / 5;
    const value = (maxDiff * i / 5).toFixed(1);
    
    // X-axis ticks
    ctx.beginPath();
    ctx.moveTo(x, height - padding);
    ctx.lineTo(x, height - padding + 5);
    ctx.stroke();
    ctx.fillText(value, x, height - padding + 15);
  }
  
  // Draw Y-axis scale (percentages)
  for (let i = 0; i <= 5; i++) {
    const y = height - padding - (height - 2 * padding) * i / 5;
    const value = (maxPercentage * i / 5).toFixed(1) + '%';
    
    // Y-axis ticks
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(padding - 5, y);
    ctx.stroke();
    ctx.fillText(value, padding - 20, y + 5);
  }
  
  // Draw Dataset A histogram bars
  const barWidth = (width - 2 * padding) / binCount * 0.4;
  ctx.fillStyle = 'rgba(75, 192, 192, 0.7)';
  
  for (let i = 0; i < binCount; i++) {
    const x = padding + (width - 2 * padding) * i / binCount + barWidth * 0.25;
    const barHeight = (height - 2 * padding) * histogramA[i] / maxPercentage;
    const y = height - padding - barHeight;
    
    ctx.fillRect(x, y, barWidth, barHeight);
  }
  
  // Draw Dataset B histogram bars
  ctx.fillStyle = 'rgba(255, 99, 132, 0.7)';
  
  for (let i = 0; i < binCount; i++) {
    const x = padding + (width - 2 * padding) * i / binCount + barWidth + barWidth * 0.5;
    const barHeight = (height - 2 * padding) * histogramB[i] / maxPercentage;
    const y = height - padding - barHeight;
    
    ctx.fillRect(x, y, barWidth, barHeight);
  }
  
  // Draw legend
  ctx.fillStyle = 'rgba(75, 192, 192, 1)';
  ctx.fillRect(width - 100, 20, 15, 15);
  ctx.fillStyle = '#333';
  ctx.textAlign = 'left';
  ctx.fillText('Dataset A', width - 80, 32);
  
  ctx.fillStyle = 'rgba(255, 99, 132, 1)';
  ctx.fillRect(width - 100, 45, 15, 15);
  ctx.fillStyle = '#333';
  ctx.fillText('Dataset B', width - 80, 57);
  
  // Add caption
  ctx.textAlign = 'center';
  ctx.fillText('Frame-to-Frame Transition Distribution (narrower = more consistent)', width / 2, 20);
}

/**
 * Calculate standard deviation
 */
function calculateStdev(data) {
  if (!data || data.length < 2) return 0;
  
  const mean = calculateMean(data);
  const squaredDiffs = data.map(x => (x - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b) / data.length);
}

/**
 * Calculate mean
 */
function calculateMean(data) {
  if (!data || data.length === 0) return 0;
  return data.reduce((a, b) => a + b) / data.length;
}

// Expose these functions globally so main.js (or others) can call them
window.runStatisticalTest = runStatisticalTest;
window.runPairedTTest = runPairedTTest;
window.runMannWhitneyTest = runMannWhitneyTest;
window.runKolmogorovSmirnovTest = runKolmogorovSmirnovTest;
window.interpretKSTestResult = interpretKSTestResult;
window.runVarianceTest = runVarianceTest;
window.runFramePacingTest = runFramePacingTest;
window.interpretTTestResult = interpretTTestResult;
window.interpretMannWhitneyResult = interpretMannWhitneyResult;
window.interpretVarianceTest = interpretVarianceTest;
window.interpretFramePacingResult = interpretFramePacingResult;
window.runFrameTimeDiagnostics = runFrameTimeDiagnostics;
window.bootstrapConfidenceInterval = bootstrapConfidenceInterval;
window.visualizeBootstrapCI = visualizeBootstrapCI;
window.visualizeFrameTimeStability = visualizeFrameTimeStability;
window.renderFrameStabilityVisualization = renderFrameStabilityVisualization;
