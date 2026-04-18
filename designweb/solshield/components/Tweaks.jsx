const Tweaks = ({ state, setState }) => {
  const [open, setOpen] = React.useState(false);

  // Listen for host toggle
  React.useEffect(() => {
    const onMsg = (e) => {
      if (e.data?.type === '__activate_edit_mode') setOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    // announce availability AFTER listener is wired
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const persist = (edits) => {
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*');
  };

  const update = (k, v) => {
    setState(s => ({ ...s, [k]: v }));
    persist({ [k]: v });
  };

  if (!open) return null;

  return (
    <aside className="tweaks">
      <div className="tweaks-head">
        <span>tweaks · solshield</span>
        <span className="close" onClick={() => setOpen(false)}>×</span>
      </div>
      <div className="tweaks-body">
        <div className="tweak-row">
          <label>accent palette</label>
          <div className="tweak-opts">
            {[
              ['triad', 'triad'],
              ['duo', 'duo'],
              ['cyan', 'cyan'],
              ['amber', 'amber'],
            ].map(([k, label]) => (
              <button key={k} className={state.accent === k ? 'on' : ''} onClick={() => update('accent', k)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="tweak-row">
          <label>hero style</label>
          <div className="tweak-opts">
            {[
              ['terminal', 'terminal'],
              ['minimal',  'minimal'],
              ['wide',     'wide copy'],
            ].map(([k, label]) => (
              <button key={k} className={state.heroStyle === k ? 'on' : ''} onClick={() => update('heroStyle', k)}>{label}</button>
            ))}
          </div>
        </div>

        <div className="tweak-row">
          <label>density</label>
          <div className="tweak-opts">
            {['airy', 'medium', 'dense'].map(k => (
              <button key={k} className={state.density === k ? 'on' : ''} onClick={() => update('density', k)}>{k}</button>
            ))}
          </div>
        </div>

        <div className="tweak-row tweak-toggle">
          <label style={{margin: 0}}>matrix background</label>
          <div className={`sw ${state.matrixBg ? 'on' : ''}`} onClick={() => update('matrixBg', !state.matrixBg)} />
        </div>

        <div className="tweak-row tweak-toggle">
          <label style={{margin: 0}}>live ticker</label>
          <div className={`sw ${state.liveTicker ? 'on' : ''}`} onClick={() => update('liveTicker', !state.liveTicker)} />
        </div>
      </div>
    </aside>
  );
};

window.Tweaks = Tweaks;
