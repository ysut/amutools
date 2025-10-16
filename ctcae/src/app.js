(function(){
  // ====== 設定：ここで v5/v6 / JSON/TOML を切り替え ======
  var DATA_URL = 'data/ctcae_v5.json'; // 例: 'data/ctcae_v5.toml' でも可

  // --- 既存DOM（前メッセージの index.html と同じIDを想定） ---
  var sex = document.getElementById('sex');
  var uln_ast = document.getElementById('uln_ast');
  var uln_alt = document.getElementById('uln_alt');
  var lln_k = document.getElementById('lln_k');
  var baselineAbn = document.getElementById('baseline_abn');
  var paste = document.getElementById('paste');
  var submitBtn = document.getElementById('submitBtn');
  var clearBtn = document.getElementById('clearBtn');
  var copyBtn = document.getElementById('copyBtn');
  var printBtn = document.getElementById('printBtn');
  var tbody = document.getElementById('tbody');
  var stats = document.getElementById('stats');

  // --- ユーティリティ ---
  function norm(s){
    if(s==null) return '';
    s = String(s).toLowerCase();
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g,function(ch){return String.fromCharCode(ch.charCodeAt(0)-0xFEE0);});
    return s.replace(/\s+/g,' ').trim();
  }
  function firstNumber(s){
    var m = String(s).replace(',','.').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function hbLLN(cfg, sexVal){
    return sexVal==='M' ? (cfg.refs.LLN_Hb_M||13.0) : (cfg.refs.LLN_Hb_F||12.0);
  }

  // --- データ依存の判定 ---
  var CTCAE = null;
  var MAP = []; // {keys:[], target:"ID"}
  var INDEX = {}; // id -> lab定義

  function buildIndex(cfg){
    var i;
    MAP = cfg.map_keys || [];
    INDEX = {};
    for(i=0;i<cfg.labs.length;i++){
      INDEX[cfg.labs[i].id] = cfg.labs[i];
    }
    // 初期値セット
    if(uln_ast) uln_ast.value = cfg.refs.ULN_AST_default || 40;
    if(uln_alt) uln_alt.value = cfg.refs.ULN_ALT_default || 40;
    if(lln_k)   lln_k.value   = cfg.refs.LLN_K_default   || 3.5;
  }

  function detectTarget(name){
    var n = norm(name).replace(/\./g,'').replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\s]/g,'');
    var i,j;
    for(i=0;i<MAP.length;i++){
      for(j=0;j<MAP[i].keys.length;j++){
        if(n.indexOf(MAP[i].keys[j])>-1) return MAP[i].target;
      }
    }
    return null;
  }

  function gradeByRule(labDef, value, cfg){
    if(value==null) return {grade:0, reason:'値不備'};
    var method = labDef.method || '';
    if(method==='ratio_uln'){
      var uln = labDef.id==='AST' ? (parseFloat(uln_ast.value)||cfg.refs.ULN_AST_default||40)
                                   : (parseFloat(uln_alt.value)||cfg.refs.ULN_ALT_default||40);
      if(uln<=0) return {grade:0, reason:'ULN不備'};
      if(value <= uln) return {grade:0, reason: labDef.normal_reason || '≤ ULN'};
      var ratio = value/uln, cps = labDef.cutpoints||[], i;
      for(i=0;i<cps.length;i++){
        var c = cps[i];
        var minr = (c.min_ratio!=null)? c.min_ratio : -Infinity;
        var maxr = (c.max_ratio!=null)? c.max_ratio : Infinity;
        if(ratio >= minr && ratio < maxr) return {grade:c.grade||0, reason:c.reason||''};
      }
      return {grade:0, reason:'閾値外'};
    }
    if(method==='absolute_hb_vs_lln'){
      var lln_hb = hbLLN(cfg, sex.value);
      if(value >= lln_hb) return {grade:0, reason: labDef.normal_reason||'≥ LLN'};
      var cps2 = labDef.cutpoints||[], i2;
      for(i2=0;i2<cps2.length;i2++){
        var d = cps2[i2], minv, maxv;
        minv = (d.min==='LLN-') ? -Infinity : (d.min!=null? d.min : -Infinity);
        maxv = (d.max!=null? d.max : Infinity);
        if(value >= minv && value < maxv) return {grade:d.grade||0, reason:d.reason||''};
      }
      return {grade:0, reason:'閾値外'};
    }
    if(method==='absolute_k_vs_lln'){
      var llnk = parseFloat(lln_k.value)||cfg.refs.LLN_K_default||3.5;
      if(value >= llnk) return {grade:0, reason: labDef.normal_reason||'≥ LLN'};
      var cps3 = labDef.cutpoints||[], i3;
      for(i3=0;i3<cps3.length;i3++){
        var e = cps3[i3], minv2, maxv2;
        minv2 = (e.min==='LLN-') ? -Infinity : (e.min!=null? e.min : -Infinity);
        maxv2 = (e.max!=null? e.max : Infinity);
        if(value >= minv2 && value < maxv2) return {grade:e.grade||0, reason:e.reason||''};
      }
      return {grade:0, reason:'閾値外'};
    }
    return {grade:0, reason:'未対応method'};
  }

  function buildRow(label, value, unit, term, gobj){
    var tr = document.createElement('tr');
    function td(txt){ var c=document.createElement('td'); c.innerHTML = String(txt||''); return c; }
    tr.appendChild(td(label));
    tr.appendChild(td(value!=null? String(value):''));
    tr.appendChild(td(unit||''));
    tr.appendChild(td(term));
    tr.appendChild(td('<b>G'+(gobj.grade||0)+'</b>'));
    tr.appendChild(td(gobj.reason||''));
    return tr;
  }

  function parseAndGrade(){
    if(!CTCAE){ alert('データ未読込'); return; }
    tbody.innerHTML = '';
    var lines = paste.value.split(/\r?\n/), outCount = 0, i;

    for(i=0;i<lines.length;i++){
      var raw = lines[i];
      if(!raw || !/\d/.test(raw)) continue;

      var namePart = String(raw).split(/\s{2,}|\t+/)[0] || raw;
      var value = firstNumber(raw);
      var tgt = detectTarget(namePart);
      if(!tgt || value==null) continue;

      var def = INDEX[tgt];
      if(!def) continue;

      var g = gradeByRule(def, value, CTCAE);
      tbody.appendChild(buildRow(def.display, value, def.unit, def.ctcae_term, g));
      outCount++;
    }
    stats.innerHTML = outCount ? ('判定件数: '+outCount) : '対象項目が見つかりませんでした';
  }

  // --- 起動時：データ読込 ---
  CTCAE_LOADER.loadData(DATA_URL, function(cfg){
    CTCAE = cfg;
    buildIndex(cfg);
  }, function(err){
    alert('基準データ読込エラー: '+err);
  });

  // --- ボタン ---
  (copyBtn||{}).onclick = function(){
    try{
      var rows = tbody.querySelectorAll('tr');
      if(!rows.length){ alert('コピーする結果がありません。'); return; }
      var lines = ['項目\t値\t単位\tCTCAE用語\tGrade\t根拠'];
      for(var i=0;i<rows.length;i++){
        var tds = rows[i].children, ln=[];
        for(var j=0;j<tds.length;j++) ln.push(tds[j].innerText||'');
        lines.push(ln.join('\t'));
      }
      var ta = document.createElement('textarea');
      ta.style.position='fixed'; ta.style.left='-1000px';
      ta.value = lines.join('\n');
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      alert(ok?'表をコピーしました。':'コピーに失敗しました。');
    }catch(e){ alert('コピーに失敗しました。'); }
  };
  (printBtn||{}).onclick = function(){ window.print(); };
  (clearBtn||{}).onclick = function(){ paste.value=''; tbody.innerHTML=''; stats.innerHTML='未判定'; };
  (submitBtn||{}).onclick = parseAndGrade;
})();
