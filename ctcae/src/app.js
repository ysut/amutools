(function(){
  // === 基準・マッピング（施設値に合わせて調整可） ===
  var DEFAULTS = {
    ULN_AST: 40, // U/L
    ULN_ALT: 40, // U/L
    LLN_K: 3.5   // mmol/L
  };
  function hbLLN(sex){ return sex === 'M' ? 13.0 : 12.0; } // g/dL

  // MegaOaKの例: "001 Hb.    10.1" のような行を想定
  // key候補とCTCAEターゲットの対応
  var MAP = [
    { keys: ['hb','hemoglobin','ヘモグロビン','貧血'], target: 'HB' },
    { keys: ['ast','got'], target: 'AST' },
    { keys: ['alt','gpt'], target: 'ALT' },
    { keys: ['k','potassium','カリウム'], target: 'K' }
  ];

  // DOM
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

  function norm(s){
    if(s==null) return '';
    s = String(s).toLowerCase();
    s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g,function(ch){return String.fromCharCode(ch.charCodeAt(0)-0xFEE0);});
    return s.replace(/\s+/g,' ').trim();
  }

  function detectTarget(name){
    var n = norm(name).replace(/\./g,'').replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf\s]/g,'');
    for(var i=0;i<MAP.length;i++){
      for(var j=0;j<MAP[i].keys.length;j++){
        if(n.indexOf(MAP[i].keys[j])>-1) return MAP[i].target;
      }
    }
    return null;
  }

  // 文字列から数値を抜き出し（最初の数）
  function firstNumber(s){
    var m = String(s).replace(',','.').match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  // === CTCAE判定ロジック ===
  // AST/ALT increased（v5.0）: baseline normal想定時
  // G1: >ULN-3x, G2: >3-5x, G3: >5-20x, G4: >20x
  // baseline異常の場合は「x baseline」で置換。ここではON/OFF選択のみ対応。
  function gradeAST_ALT(value, uln, baselineAbnormal){
    if(value==null || uln==null || uln<=0) return {grade:0, reason:'値/ULN不備'};
    var ratio = value / (baselineAbnormal ? value /*ダミー*/ : uln);
    // baseline異常ON時の厳密処理は「x baseline」だが、前値が無いのでULN基準での近似表示＋注記
    // （現場で前回値があれば実装可）
    ratio = value/uln; // 実演上はULN基準で表示
    if(value <= uln) return {grade:0, reason:'≤ ULN'};
    if(ratio <= 3) return {grade:1, reason:'> ULN - 3×ULN'};
    if(ratio <= 5) return {grade:2, reason:'> 3 - 5×ULN'};
    if(ratio <= 20) return {grade:3, reason:'> 5 - 20×ULN'};
    return {grade:4, reason:'> 20×ULN'};
  }

  // 貧血（Anemia, v5準拠の定義文言）:
  // G1: Hgb < LLN - 10.0 g/dL
  // G2: <10.0 - 8.0
  // G3: <8.0（輸血適応を含む）
  // G4: 生命の危機（数値のみでは判定困難のため自動では到達させない）
  function gradeHb(hgb, lln){
    if(hgb==null) return {grade:0, reason:'値不備'};
    if(hgb >= lln) return {grade:0, reason:'≥ LLN'};
    if(hgb >= 10.0) return {grade:1, reason:'< LLN - 10.0 g/dL'};
    if(hgb >= 8.0) return {grade:2, reason:'< 10.0 - 8.0 g/dL'};
    return {grade:3, reason:'< 8.0 g/dL（G4は臨床所見で判断）'};
  }

  // 低K（Hypokalemia, v4.03数値域と整合。v5でも趣旨同じ／G1とG2は症状要件で重なりあり）
  // G0: ≥ LLN
  // G1: < LLN - 3.0
  // G2: < LLN - 3.0 で症状あり（自動付与しない）→自動判定ではG1相当
  // G3: 3.0 - 2.5
  // G4: < 2.5
  function gradeK(k, lln){
    if(k==null) return {grade:0, reason:'値不備'};
    if(k >= lln) return {grade:0, reason:'≥ LLN'};
    if(k >= 3.0) return {grade:1, reason:'< LLN - 3.0 mmol/L（症状あればG2）'};
    if(k >= 2.5) return {grade:3, reason:'3.0 - 2.5 mmol/L'};
    return {grade:4, reason:'< 2.5 mmol/L'};
  }

  function buildRow(label, value, unit, ctcaeTerm, gobj){
    var tr = document.createElement('tr');
    function td(txt){ var c=document.createElement('td'); c.innerHTML = String(txt||''); return c; }
    tr.appendChild(td(label));
    tr.appendChild(td(value!=null? String(value):''));
    tr.appendChild(td(unit||''));
    tr.appendChild(td(ctcaeTerm));
    tr.appendChild(td('<b>G'+(gobj.grade||0)+'</b>'));
    tr.appendChild(td(gobj.reason||''));
    return tr;
  }

  function parseAndGrade(){
    var lines = paste.value.split(/\r?\n/);
    var outCount = 0;
    tbody.innerHTML = '';
    var uAST = parseFloat(uln_ast.value)||DEFAULTS.ULN_AST;
    var uALT = parseFloat(uln_alt.value)||DEFAULTS.ULN_ALT;
    var lK = parseFloat(lln_k.value)||DEFAULTS.LLN_K;
    var sexVal = sex.value;
    var hLLN = hbLLN(sexVal);

    // 入力に含まれる対象のみ評価
    for(var i=0;i<lines.length;i++){
      var raw = lines[i];
      if(!raw || !/\d/.test(raw)) continue;

      // 左側に名称、右側に数値がある想定で先に名前を取り出す
      // 例: "001 Hb.    10.1"
      var namePart = String(raw).split(/\s{2,}|\t+/)[0] || raw;
      var value = firstNumber(raw);
      var tgt = detectTarget(namePart);

      if(!tgt || value==null) continue;

      if(tgt==='AST'){
        var g = gradeAST_ALT(value, uAST, !!baselineAbn.checked);
        tbody.appendChild(buildRow('AST', value, 'U/L', 'AST increased', g));
        outCount++;
      } else if(tgt==='ALT'){
        var g2 = gradeAST_ALT(value, uALT, !!baselineAbn.checked);
        tbody.appendChild(buildRow('ALT', value, 'U/L', 'ALT increased', g2));
        outCount++;
      } else if(tgt==='HB'){
        var g3 = gradeHb(value, hLLN);
        tbody.appendChild(buildRow('Hb', value, 'g/dL', 'Anemia', g3));
        outCount++;
      } else if(tgt==='K'){
        var g4 = gradeK(value, lK);
        tbody.appendChild(buildRow('K', value, 'mmol/L', 'Hypokalemia', g4));
        outCount++;
      }
    }

    stats.innerHTML = outCount ? ('判定件数: '+outCount) : '対象項目が見つかりませんでした';
  }

  // クリップボード系
  copyBtn.onclick = function(){
    try{
      var rows = tbody.querySelectorAll('tr');
      if(!rows.length){ alert('コピーする結果がありません。'); return; }
      var lines = ['項目\t値\t単位\tCTCAE用語\tGrade\t根拠'];
      for(var i=0;i<rows.length;i++){
        var tds = rows[i].children;
        var ln = [];
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

  printBtn.onclick = function(){ window.print(); };
  clearBtn.onclick = function(){ paste.value=''; tbody.innerHTML=''; stats.innerHTML='未判定'; };
  submitBtn.onclick = parseAndGrade;
})();
