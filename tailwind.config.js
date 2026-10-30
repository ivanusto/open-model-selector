// 原本寫在 index.html 給 Tailwind Play CDN 的設定，改由建置時產生 assets/tailwind.css
// 全站色票由 CSS 變數供給（莫蘭迪色系，深／淺兩套，定義在 src/tailwind.css）
const morandiScale = (family, steps) => Object.fromEntries(
  steps.map(s => [s, `rgb(var(--c-${family}-${s}) / <alpha-value>)`])
);

module.exports = {
  content: ['./index.html', './app.js', './data.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        white: 'rgb(var(--c-white) / <alpha-value>)',
        slate: morandiScale('slate', [100, 200, 300, 400, 500, 700, 800, 900, 950]),
        emerald: morandiScale('emerald', [300, 400, 500, 950]),
        indigo: morandiScale('indigo', [200, 300, 400, 500, 600, 950]),
        cyan: morandiScale('cyan', [300, 400, 500]),
        amber: morandiScale('amber', [300, 400, 500]),
        rose: morandiScale('rose', [300, 400, 500, 900, 950]),
        teal: morandiScale('teal', [400, 500]),
        orange: morandiScale('orange', [300, 400, 500]),
        purple: morandiScale('purple', [300, 500]),
        brand: {
          50: 'rgb(var(--c-emerald-300) / <alpha-value>)',
          400: 'rgb(var(--c-emerald-400) / <alpha-value>)',
          500: 'rgb(var(--c-emerald-500) / <alpha-value>)',
          600: 'rgb(var(--c-teal-500) / <alpha-value>)',
          900: 'rgb(var(--c-emerald-950) / <alpha-value>)',
          950: 'rgb(var(--c-emerald-950) / <alpha-value>)'
        }
      },
      fontFamily: {
        // 不載入外部字型，直接用系統字型
        sans: ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
      }
    }
  }
};
