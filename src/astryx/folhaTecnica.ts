import { defineTheme } from '@astryxdesign/core/theme'

/**
 * "Folha técnica" (DESIGN.md) expressed as an Astryx theme: parchment paper,
 * ink, hairline borders, no shadows, pill controls. Colour is reserved for
 * load state (ok / warm / hot) and the single primary action (accent blue).
 */
export const folhaTecnica = defineTheme({
  name: 'folha-tecnica',
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: 'IBM Plex Mono', fallbacks: 'ui-monospace, Menlo, Consolas, monospace' },
    heading: { family: 'Instrument Serif', fallbacks: 'Georgia, "Times New Roman", serif', weights: { 1: 'normal', 2: 'normal', 3: 'normal', 4: 'normal' } },
    code: { family: 'IBM Plex Mono', fallbacks: 'ui-monospace, Menlo, Consolas, monospace' },
  },
  tokens: {
    '--color-background-body': '#f6f3f1',
    '--color-background-surface': '#f6f3f1',
    '--color-background-card': '#f6f3f1',
    '--color-background-popover': '#f6f3f1',
    '--color-background-muted': '#ece8e5',
    '--color-text-primary': '#242424',
    '--color-text-secondary': '#4e4d4d',
    '--color-text-disabled': '#4e4d4d',
    '--color-border': '#cecac8',
    '--color-border-emphasized': '#242424',
    '--color-accent': '#2b59d1',
    '--color-on-accent': '#f6f3f1',
    '--color-text-accent': '#2b59d1',
    '--color-overlay': 'rgb(36 36 36 / 0.4)',
    // State colours: the only colour in the interface.
    '--color-success': '#1f6e47',
    '--color-success-muted': '#a7fccd',
    '--color-on-success': '#f6f3f1',
    '--color-on-success-muted': '#1f6e47',
    '--color-text-success': '#1f6e47',
    '--color-warning': '#8a5a00',
    '--color-warning-muted': '#ecda98',
    '--color-on-warning': '#f6f3f1',
    '--color-on-warning-muted': '#8a5a00',
    '--color-text-warning': '#8a5a00',
    '--color-error': '#b4380c',
    '--color-error-muted': '#ff9473',
    '--color-on-error': '#f6f3f1',
    '--color-on-error-muted': '#b4380c',
    '--color-text-error': '#b4380c',
    // No shadows: elevation is a 1px border.
    '--shadow-low': 'none',
    '--shadow-med': 'none',
    '--shadow-high': 'none',
    '--radius-container': '24px',
    '--radius-element': '999px',
    '--radius-inner': '12px',
  },
})
