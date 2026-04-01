export const normalizeHexColor = (value) => {
  if (!value || typeof value !== 'string') return null;
  let hex = value.trim();
  if (!hex) return null;
  if (!hex.startsWith('#')) hex = `#${hex}`;
  if (hex.length === 4) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return null;
  return hex.toUpperCase();
};

export const USER_ACCENT_STORAGE_KEY = 'ada:user-accent-color';

const hexToRgb = (hex) => {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const num = parseInt(normalized.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
};

const rgbToHex = ({ r, g, b }) => {
  const clamp = (channel) => Math.min(255, Math.max(0, Math.round(channel)));
  return `#${((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1)}`.toUpperCase();
};

const srgbToLinear = (value) => {
  const channel = value / 255;
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
};

const relativeLuminance = (hex) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (hexA, hexB) => {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
};

const rgbToHsl = ({ r, g, b }) => {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === rNorm) h = ((gNorm - bNorm) / delta) % 6;
    if (max === gNorm) h = (bNorm - rNorm) / delta + 2;
    if (max === bNorm) h = (rNorm - gNorm) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
};

const hslToRgb = ({ h, s, l }) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c;
    g = x;
  } else if (h >= 60 && h < 120) {
    r = x;
    g = c;
  } else if (h >= 120 && h < 180) {
    g = c;
    b = x;
  } else if (h >= 180 && h < 240) {
    g = x;
    b = c;
  } else if (h >= 240 && h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  };
};

const adjustLightness = (hex, delta) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  const next = Math.min(1, Math.max(0, hsl.l + delta));
  return rgbToHex(hslToRgb({ ...hsl, l: next }));
};

const mixHex = (hexA, hexB, weight) => {
  const rgbA = hexToRgb(hexA);
  const rgbB = hexToRgb(hexB);
  if (!rgbA || !rgbB) return hexA;
  return rgbToHex({
    r: rgbA.r * weight + rgbB.r * (1 - weight),
    g: rgbA.g * weight + rgbB.g * (1 - weight),
    b: rgbA.b * weight + rgbB.b * (1 - weight),
  });
};

const pickTextColor = (hex) => {
  const white = '#FFFFFF';
  const nearBlack = '#3C2F33';
  return contrastRatio(hex, white) >= contrastRatio(hex, nearBlack) ? white : nearBlack;
};

const adjustHex = (hex, amount) => {
  const value = (hex || '').replace('#', '');
  if (value.length !== 6) return hex;
  const num = parseInt(value, 16);
  const clamp = (channel) => Math.min(255, Math.max(0, channel));
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0x00ff) + amount);
  const b = clamp((num & 0x0000ff) + amount);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

const adjustSaturation = (hex, delta) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const hsl = rgbToHsl(rgb);
  const next = Math.min(1, Math.max(0, hsl.s + delta));
  return rgbToHex(hslToRgb({ ...hsl, s: next }));
};

const ensureContrast = (hex, bgHex, minRatio) => {
  const base = normalizeHexColor(hex);
  const bg = normalizeHexColor(bgHex);
  if (!base || !bg) return hex;
  if (contrastRatio(base, bg) >= minRatio) return base;
  const bgIsLight = relativeLuminance(bg) > 0.5;
  const direction = bgIsLight ? -1 : 1;
  let candidate = base;
  for (let i = 0; i < 18; i += 1) {
    candidate = adjustLightness(candidate, direction * 0.05);
    if (contrastRatio(candidate, bg) >= minRatio) return candidate;
  }
  return candidate;
};

export const getDefaultAccent = () => {
  if (typeof document === 'undefined') return '#F3B8CF';
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent-primary')
    .trim();
  return value || '#F3B8CF';
};

export const getThemeBackgrounds = () => {
  if (typeof document === 'undefined') {
    return {
      light: { bgPrimary: '#F4F3F1', bgSecondary: '#EEEDEB' },
      dark: { bgPrimary: '#2C2C2C', bgSecondary: '#1E1E1E' },
    };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    light: {
      bgPrimary: styles.getPropertyValue('--bg-primary-light').trim() || styles.getPropertyValue('--bg-primary').trim(),
      bgSecondary: styles.getPropertyValue('--bg-secondary-light').trim() || styles.getPropertyValue('--bg-secondary').trim(),
    },
    dark: {
      bgPrimary: styles.getPropertyValue('--bg-primary-dark').trim() || styles.getPropertyValue('--bg-primary').trim(),
      bgSecondary: styles.getPropertyValue('--bg-secondary-dark').trim() || styles.getPropertyValue('--bg-secondary').trim(),
    },
  };
};

export const buildAccentSet = (hex, theme) => {
  const bgPrimary = theme.bgPrimary;
  const bgSecondary = theme.bgSecondary;
  const lumPrimary = relativeLuminance(bgPrimary);
  const lumSecondary = relativeLuminance(bgSecondary);
  const targetBg = lumPrimary >= lumSecondary ? bgPrimary : bgSecondary;
  const isLightTheme = lumPrimary > 0.5;

  if (!isLightTheme) {
    const minRatio = 4.5;
    const accent = ensureContrast(hex, targetBg, minRatio);
    const hover = adjustHex(accent, -18);
    const secondary = adjustLightness(accent, -0.14);
    const highlight = mixHex(accent, targetBg, 0.22);
    const contrast = pickTextColor(accent);
    return { accent, hover, secondary, highlight, contrast };
  }

  const minRatio = 2.8;
  const contrastSafe = ensureContrast(hex, targetBg, minRatio);
  const baseRgb = hexToRgb(contrastSafe);
  const baseSaturation = baseRgb ? rgbToHsl(baseRgb).s : 0.4;
  const isHighSaturation = baseSaturation > 0.55;

  const toned = adjustSaturation(contrastSafe, isHighSaturation ? -0.30 : -0.08);
  const softened = mixHex(toned, targetBg, isHighSaturation ? 0.62 : 0.82);
  const accent = ensureContrast(softened, targetBg, minRatio);
  const hover = adjustLightness(accent, isHighSaturation ? -0.04 : -0.03);
  const secondary = mixHex(accent, targetBg, isHighSaturation ? 0.28 : 0.46);
  const highlight = mixHex(accent, targetBg, isHighSaturation ? 0.14 : 0.22);
  const contrast = pickTextColor(accent);
  return { accent, hover, secondary, highlight, contrast };
};

export const applyAccentColor = (color) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const nextColor = normalizeHexColor(color || getDefaultAccent());
  const customVars = [
    '--accent-primary-custom',
    '--accent-hover-custom',
    '--accent-secondary-custom',
    '--accent-highlight-custom',
    '--accent-contrast-custom',
    '--accent-primary-custom-dark',
    '--accent-hover-custom-dark',
    '--accent-secondary-custom-dark',
    '--accent-highlight-custom-dark',
    '--accent-contrast-custom-dark',
  ];

  if (!nextColor) {
    customVars.forEach((key) => root.style.removeProperty(key));
    return;
  }

  const themes = getThemeBackgrounds();
  const lightSet = buildAccentSet(nextColor, themes.light);
  const darkSet = buildAccentSet(nextColor, themes.dark);

  root.style.setProperty('--accent-primary-custom', lightSet.accent);
  root.style.setProperty('--accent-hover-custom', lightSet.hover);
  root.style.setProperty('--accent-secondary-custom', lightSet.secondary);
  root.style.setProperty('--accent-highlight-custom', lightSet.highlight);
  root.style.setProperty('--accent-contrast-custom', lightSet.contrast);

  root.style.setProperty('--accent-primary-custom-dark', darkSet.accent);
  root.style.setProperty('--accent-hover-custom-dark', darkSet.hover);
  root.style.setProperty('--accent-secondary-custom-dark', darkSet.secondary);
  root.style.setProperty('--accent-highlight-custom-dark', darkSet.highlight);
  root.style.setProperty('--accent-contrast-custom-dark', darkSet.contrast);
};

export const buildAccessibleAccentTokens = (accentHex, backgroundHex) => {
  const baseAccent = normalizeHexColor(accentHex);
  const bg = normalizeHexColor(backgroundHex) || '#F4F3F1';
  if (!baseAccent) return null;

  const bgIsLight = relativeLuminance(bg) > 0.5;
  let accent = baseAccent;
  const minRatio = bgIsLight ? 2.8 : 4.5;

  if (contrastRatio(accent, bg) < minRatio) {
    const direction = bgIsLight ? -1 : 1;
    for (let i = 0; i < 16; i += 1) {
      accent = adjustLightness(accent, direction * 0.045);
      if (contrastRatio(accent, bg) >= minRatio) break;
    }
  }

  const hover = adjustLightness(accent, bgIsLight ? -0.06 : 0.06);
  const secondary = mixHex(accent, bg, bgIsLight ? 0.3 : 0.42);
  const highlight = mixHex(accent, bg, bgIsLight ? 0.12 : 0.24);
  const contrast = pickTextColor(accent);

  return {
    accent,
    hover,
    secondary,
    highlight,
    contrast,
  };
};

export const buildAccentStyleVars = (accentHex, backgroundHex) => {
  const tokens = buildAccessibleAccentTokens(accentHex, backgroundHex);
  if (!tokens) return undefined;
  return {
    '--accent-primary': tokens.accent,
    '--accent-hover': tokens.hover,
    '--accent-secondary': tokens.secondary,
    '--accent-highlight': tokens.highlight,
    '--accent-contrast': tokens.contrast,
  };
};
