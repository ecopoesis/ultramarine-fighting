// The printed-document look shared by the component manifest and the rulebook: harbour
// fog, chart ink, verdigris for anything printed on a component, lobster red for the
// one thing that matters. Both documents are generated from src/config.ts.
export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo+Narrow:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">`;

export const BASE_CSS = `  :root{
    --fog:#E8EDEB; --panel:#F3F6F5; --ink:#16232B; --muted:#5C6B6E;
    --rule:#BDC9C6; --accent:#C93F1D; --verdigris:#357367; --verdigris-wash:#E2ECE8;
    color-scheme:light;
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --fog:#0E171C; --panel:#152128; --ink:#DCE5E3; --muted:#8FA2A4;
      --rule:#2A3A42; --accent:#F0663F; --verdigris:#6FB8A6; --verdigris-wash:#16262A;
      color-scheme:dark;
    }
  }
  :root[data-theme="dark"]{
    --fog:#0E171C; --panel:#152128; --ink:#DCE5E3; --muted:#8FA2A4;
    --rule:#2A3A42; --accent:#F0663F; --verdigris:#6FB8A6; --verdigris-wash:#16262A;
    color-scheme:dark;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--fog); color:var(--ink);
    font-family:"Source Serif 4",Georgia,"Times New Roman",serif;
    font-size:16px; line-height:1.55;
  }
  .sheet{max-width:60rem; margin:0 auto; padding-block:clamp(2rem,6vw,4.5rem); padding-left:20px; padding-right:20px;}

  .masthead{border-bottom:3px solid var(--ink); padding-bottom:1.25rem; display:flex; flex-wrap:wrap; align-items:flex-end; gap:1rem 2rem;}
  .masthead h1{
    font-family:"Archivo Narrow",Arial Narrow,Helvetica,sans-serif;
    font-weight:700; font-size:clamp(2.4rem,7vw,4rem); line-height:.95; margin:0;
    letter-spacing:-.01em; text-transform:uppercase; text-wrap:balance; flex:1 1 18rem;
  }
  .masthead h1 small{display:block; font-size:.28em; letter-spacing:.22em; color:var(--accent); font-weight:600; margin-bottom:.5rem;}
  .stamp{
    font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace; font-size:.72rem; line-height:1.7;
    color:var(--muted); text-align:right; border-left:1px solid var(--rule); padding-left:1.25rem;
  }
  .stamp b{color:var(--ink); font-weight:500;}

  .standfirst{
    font-size:1.1rem; max-width:62ch; margin:1.75rem 0 0; color:var(--ink);
  }
  .standfirst em{color:var(--accent); font-style:normal; font-weight:600;}

  .scales{
    display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:1px;
    background:var(--rule); border:1px solid var(--rule); margin-top:2.25rem;
  }
  .scale{background:var(--panel); padding:.9rem 1rem;}
  .scale dt{
    font-family:"Archivo Narrow",Arial Narrow,sans-serif; text-transform:uppercase;
    letter-spacing:.14em; font-size:.66rem; color:var(--muted); font-weight:600;
  }
  .scale dd{
    margin:.3rem 0 0; font-family:"IBM Plex Mono",monospace; font-size:1.35rem;
    font-variant-numeric:tabular-nums; color:var(--ink);
  }

  .group{margin-top:3.5rem;}
  .group-head{display:flex; align-items:baseline; gap:1rem; border-bottom:1px solid var(--ink); padding-bottom:.4rem;}
  .group-head h2{
    font-family:"Archivo Narrow",Arial Narrow,sans-serif; text-transform:uppercase;
    letter-spacing:.1em; font-size:1.05rem; font-weight:700; margin:0; flex:1;
  }
  .tally{
    font-family:"IBM Plex Mono",monospace; font-size:.75rem; color:var(--accent);
    font-variant-numeric:tabular-nums;
  }
  .blurb{color:var(--muted); max-width:62ch; margin:.9rem 0 0; font-size:.95rem;}

  .parts{list-style:none; margin:1.25rem 0 0; padding:0; display:flex; flex-direction:column; gap:1.5rem;}
  .part{display:grid; grid-template-columns:4.5rem 1fr; gap:1.25rem; align-items:start;}
  .qty{
    font-family:"IBM Plex Mono",monospace; font-variant-numeric:tabular-nums;
    font-size:1rem; color:var(--accent); text-align:right; padding-top:.1rem;
    border-right:1px solid var(--rule); padding-right:1.25rem; min-height:1.4rem;
  }
  .detail h3{
    font-family:"Archivo Narrow",Arial Narrow,sans-serif; font-weight:600; font-size:1.02rem;
    margin:0; letter-spacing:.01em;
  }
  .printed{
    font-family:"IBM Plex Mono",monospace; font-size:.78rem; line-height:1.65;
    background:var(--verdigris-wash); border-left:2px solid var(--verdigris);
    color:var(--ink); margin:.5rem 0 0; padding:.6rem .8rem; white-space:pre-wrap;
    overflow-x:auto;
  }
  .note{color:var(--muted); font-size:.9rem; margin:.5rem 0 0; max-width:62ch;}

  footer{
    margin-top:4rem; border-top:1px solid var(--rule); padding-top:1.25rem;
    color:var(--muted); font-size:.85rem; max-width:62ch;
  }
  footer code{font-family:"IBM Plex Mono",monospace; color:var(--ink); font-size:.95em;}

  @media (max-width:520px){
    .part{grid-template-columns:3.2rem 1fr; gap:.85rem;}
    .qty{padding-right:.85rem;}
    .stamp{text-align:left; border-left:0; padding-left:0;}
  }
`;
