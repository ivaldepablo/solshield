/* SolShield main app — wires together the landing page */

const _raw = document.getElementById('TWEAK_DEFAULTS').textContent
  .replace(/\/\*[\s\S]*?\*\//g, '').trim();
const DEFAULTS = JSON.parse(_raw);

const App = () => {
  const [state, setState] = React.useState(DEFAULTS);

  // Apply tweaks to <html>
  React.useEffect(() => {
    document.documentElement.dataset.accent = state.accent;
    document.documentElement.dataset.density = state.density;
    document.documentElement.dataset.hero = state.heroStyle;
  }, [state]);

  return (
    <>
      <window.MatrixBg enabled={state.matrixBg} />
      <div style={{position: 'relative', zIndex: 1}}>
        <window.Nav />
        <window.Hero accent={state.accent} heroStyle={state.heroStyle} />
        <window.StatsStrip ticker={state.liveTicker} />
        <window.Features />
        <window.PoweredByClaude />
        <window.OverlayDemo />
        <window.Comparison />
        <window.Wallets />
        <window.Install />
        <window.Footer />
      </div>
      <window.Tweaks state={state} setState={setState} />
    </>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
