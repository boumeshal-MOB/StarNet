// ---------------------------------------------------------------------------
// Statistical helpers: chi-square distribution (CDF and inverse CDF) used for
// the two-sided chi-square test of the adjustment. Implemented locally with
// the regularized incomplete gamma function so the mockup has no runtime
// dependency for statistics.
// ---------------------------------------------------------------------------

/** natural log of the gamma function (Lanczos approximation) */
export function lnGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** regularized lower incomplete gamma P(a, x) */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    // series expansion
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // continued fraction for Q(a,x)
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  const q = Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
  return 1 - q;
}

/** chi-square CDF with k degrees of freedom */
export function chi2Cdf(x: number, k: number): number {
  if (x <= 0) return 0;
  return gammaP(k / 2, x / 2);
}

/**
 * chi-square quantile (inverse CDF). Wilson-Hilferty initial guess refined
 * with Newton iterations on the CDF.
 */
export function chi2Inv(p: number, k: number): number {
  if (k <= 0) return NaN;
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  // Wilson-Hilferty
  const z = normInv(p);
  const t = 1 - 2 / (9 * k) + z * Math.sqrt(2 / (9 * k));
  let x = k * t * t * t;
  if (!(x > 0)) x = k;
  for (let i = 0; i < 60; i++) {
    const f = chi2Cdf(x, k) - p;
    // pdf
    const lnPdf = (k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.log(2) - lnGamma(k / 2);
    const pdf = Math.exp(lnPdf);
    if (pdf < 1e-300) break;
    const dx = f / pdf;
    x -= dx;
    if (x <= 0) x = 1e-8;
    if (Math.abs(dx) < 1e-10 * (1 + x)) break;
  }
  return x;
}

/** standard normal quantile (Acklam's algorithm) */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const pl = 0.02425;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * scale factor applied to 1-sigma error ellipses to reach the requested
 * 2D confidence level (chi-square with 2 dof).
 */
export function ellipseConfidenceScale(confidence: number): number {
  return Math.sqrt(chi2Inv(confidence, 2));
}
