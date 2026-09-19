// Categorical colours for charts and maps, in a fixed order: a series keeps its colour whatever else is drawn.
/** The categorical order the site uses everywhere: green, blue, orange, violet, teal, then quieter tones. */
export const SERIES_COLORS = {
  light: ["#1b7a4f", "#2f66c4", "#c46a1b", "#7a4fd1", "#1391a6", "#8f6c12", "#b3405e", "#5b8a1e"],
  dark: ["#33a86c", "#6690e6", "#cf7c2b", "#9d7be8", "#2aa3b6", "#a8882a", "#d46e87", "#72a132"],
};

/** Points and legend keys for a missing value: neutral, so "no value" never reads as one more category. */
export const NO_VALUE_COLORS = { light: "#99a19a", dark: "#5e6561" };
