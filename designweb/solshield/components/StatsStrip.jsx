const StatsStrip = () => {
  return (
    <section className="stats">
      <div className="container stats-grid">
        <div className="stat">
          <div className="v">23</div>
          <div className="l">deterministic rules</div>
          <div className="d"><span className="up">▲ live</span> · 17 tx + 6 message</div>
        </div>
        <div className="stat">
          <div className="v">2<span className="u"> models</span></div>
          <div className="l">claude opus 4.7 + haiku 4.5</div>
          <div className="d"><span className="up">▲</span> auditable prompts in-tree</div>
        </div>
        <div className="stat">
          <div className="v">~1<span className="u">s</span></div>
          <div className="l">verdict time (p50)</div>
          <div className="d">live on magiceden, jupiter, tensor</div>
        </div>
        <div className="stat">
          <div className="v">v0.4.10</div>
          <div className="l">public beta · apr 2026</div>
          <div className="d"><span className="up">▲</span> 1 maintainer · PRs welcome</div>
        </div>
      </div>
    </section>
  );
};

window.StatsStrip = StatsStrip;
