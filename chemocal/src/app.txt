// IE11対応：ES5のみ
(function () {
  function toast(msg) {
    var t = document.getElementById('toast');
    t.innerText = msg;
    t.style.display = '';
    setTimeout(function(){ t.style.display='none'; }, 2000);
  }

  function parseNum(s) {
    if (typeof s !== 'string') return NaN;
    s = s.replace(/[\uFF10-\uFF19]/g, function(ch){ return String.fromCharCode(ch.charCodeAt(0)-0xFF10+48); });
    s = s.replace(/\uFF0E/g, '.');
    s = s.replace(/,/g, '');
    return parseFloat(s);
  }

  // Devine（cm表記）
  function devineIBW(sex, heightCm) {
    var slope = 2.3 / 2.54; // ≈0.9055 kg/cm over 152.4cm
    var over = heightCm - 152.4;
    if (over < 0) over = 0;
    var base = (sex === 'male') ? 50.0 : 45.5;
    return base + slope * over;
  }
  function adjBW(ibw, actual) { return ibw + 0.4 * (actual - ibw); }
  function bmi(weightKg, heightCm) { var m = heightCm / 100.0; return weightKg / (m * m); }
  // BMI>25 → AdjBW、≤25 → Actual
  function chooseWeightByBMI(sex, heightCm, actualKg) {
    var ibw = devineIBW(sex, heightCm);
    var b = bmi(actualKg, heightCm);
    var used, label;
    if (b > 25) { used = adjBW(ibw, actualKg); label = 'AdjBW（BMI>25）'; }
    else { used = actualKg; label = 'Actual（BMI≤25）'; }
    if (used <= 0) used = actualKg;
    return { used: used, label: label, ibw: ibw, bmi: b };
  }

  function cockcroftGault(age, scr, sex, weightKg) {
    var crcl = ((140 - age) * weightKg) / (72 * scr);
    if (sex === 'female') crcl = crcl * 0.85;
    return crcl;
  }
  function calvertDose(targetAuc, gfr) { return targetAuc * (gfr + 25.0); }

  function showError(msg) {
    var err = document.getElementById('err');
    err.innerText = msg;
    err.style.display = msg ? '' : 'none';
  }

  function showResult(rawGfr, usedGfr, wtInfo, dose, inputs, scrUsed) {
    document.getElementById('bmiVal').innerText = wtInfo.bmi.toFixed(1);
    document.getElementById('wtUsedLabel').innerText = wtInfo.label;
    document.getElementById('wtUsedVal').innerText   = wtInfo.used.toFixed(1);

    document.getElementById('gfrRaw').innerText  = rawGfr.toFixed(1);
    document.getElementById('gfrUsed').innerText = usedGfr.toFixed(1);
    document.getElementById('scrUsed').innerText = scrUsed.toFixed(2);
    document.getElementById('doseMg').innerText = dose.toFixed(0);

    var detail = ''
      + '性別: ' + (inputs.sex === 'male' ? '男性' : '女性')
      + ' / 年齢: ' + inputs.age + ' 歳'
      + ' / 身長: ' + inputs.height + ' cm'
      + ' / 体重(実): ' + inputs.weight + ' kg'
      + ' / IBW: ' + wtInfo.ibw.toFixed(1) + ' kg'
      + ' / AUC: ' + inputs.auc
      + (inputs.cap ? ' / GFR上限: 125適用' : ' / GFR上限: なし');
    document.getElementById('detail').innerText = detail;

    document.getElementById('result').style.display = '';
  }

  function clearResult() {
    document.getElementById('result').style.display = 'none';
    document.getElementById('bmiVal').innerText = '-';
    document.getElementById('wtUsedLabel').innerText = '-';
    document.getElementById('wtUsedVal').innerText = '-';
    document.getElementById('gfrRaw').innerText = '-';
    document.getElementById('gfrUsed').innerText = '-';
    document.getElementById('doseMg').innerText = '-';
    document.getElementById('scrUsed').innerText = '-';
    document.getElementById('detail').innerText = '';
  }

  // ====== 計算処理 ======
  window.onload = function () {
    var form = document.getElementById('calcForm');

    form.onsubmit = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      showError(''); clearResult();

      var sex = (function(){
        var nodes = document.getElementsByName('sex');
        for (var i=0;i<nodes.length;i++){ if (nodes[i].checked) return nodes[i].value; }
        return 'female';
      })();
      var age = parseNum(document.getElementById('age').value);
      var height = parseNum(document.getElementById('height').value);
      var weight = parseNum(document.getElementById('weight').value);
      var scrInput = parseNum(document.getElementById('scr').value);
      var auc = parseNum(document.getElementById('auc').value);
      var cap = document.getElementById('capGfr').checked;

      if (isNaN(age) || isNaN(height) || isNaN(weight) || isNaN(scrInput) || isNaN(auc)) {
        showError('全ての項目に数値を入力してください。'); return false;
      }
      if (age <= 0 || height <= 0 || weight <= 0 || scrInput <= 0 || auc <= 0) {
        showError('0より大きい値を入力してください。'); return false;
      }
      if (age > 120 || height < 80 || height > 250 || weight > 500 || scrInput > 20 || auc > 15) {
        showError('入力値が不自然です。単位（cm, kg, mg/dL）やAUCをご確認ください。'); return false;
      }

      // Scr 0.7未満は0.7で計算
      var scrUsed = scrInput < 0.7 ? 0.7 : scrInput;

      // 体重選択（BMI基準）
      var wtInfo = chooseWeightByBMI(sex, height, weight);

      // GFR（CrCl）
      var gfrRaw = cockcroftGault(age, scrUsed, sex, wtInfo.used);
      var gfrUsed = gfrRaw;
      if (cap && isFinite(gfrUsed) && gfrUsed > 125) gfrUsed = 125;
      if (!isFinite(gfrRaw) || !isFinite(gfrUsed) || gfrRaw <= 0) {
        showError('GFRの計算に失敗しました。'); return false;
      }

      // Calvert
      var dose = calvertDose(auc, gfrUsed);
      if (!isFinite(dose) || dose <= 0) { showError('用量の計算に失敗しました。'); return false; }

      showResult(gfrRaw, gfrUsed, wtInfo, dose, {
        sex: sex, age: age, height: height, weight: weight, auc: auc, cap: cap
      }, scrUsed);
      return false;
    };

    document.getElementById('resetBtn').onclick = function () {
      var ids = ['age','height','weight','scr','auc'];
      for (var i=0;i<ids.length;i++){ document.getElementById(ids[i]).value=''; }
      document.getElementById('capGfr').checked = true;
      var radios = document.getElementsByName('sex');
      for (var j=0;j<radios.length;j++){ radios[j].checked = (radios[j].value==='female'); }
      showError(''); clearResult(); document.getElementById('age').focus();
    };

    // ===== 画像出力・テキストコピー =====
    function buildSummaryText() {
      var sexTxt = (function(){ var n = document.getElementsByName('sex'); for(var i=0;i<n.length;i++){ if(n[i].checked) return (n[i].value==='male')?'男性':'女性'; } return '女性'; })();
      var t = '【Carboplatin 計算結果】\r\n'
        + '性別: ' + sexTxt + '\r\n'
        + '年齢: ' + (document.getElementById('age').value||'-') + ' 歳\r\n'
        + '身長: ' + (document.getElementById('height').value||'-') + ' cm\r\n'
        + '体重: ' + (document.getElementById('weight').value||'-') + ' kg\r\n'
        + '血清Cr(使用): ' + (document.getElementById('scrUsed').innerText||'-') + ' mg/dL\r\n'
        + 'BMI: ' + (document.getElementById('bmiVal').innerText||'-') + ' kg/m²\r\n'
        + '採用体重: ' + (document.getElementById('wtUsedLabel').innerText||'-') + ' / ' + (document.getElementById('wtUsedVal').innerText||'-') + ' kg\r\n'
        + 'GFR(生値/使用): ' + (document.getElementById('gfrRaw').innerText||'-') + ' / ' + (document.getElementById('gfrUsed').innerText||'-') + ' mL/min\r\n'
        + '投与量: ' + (document.getElementById('doseMg').innerText||'-') + ' mg\r\n';
      return t;
    }

    function drawSummaryCanvas() {
      var w = 720, h = 280;
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var g = c.getContext('2d');

      g.fillStyle = '#ffffff';
      g.fillRect(0,0,w,h);

      g.fillStyle = '#222222';
      g.font = '16px Arial';
      g.fillText('Carboplatin 用量計算（Calvert）', 16, 28);

      g.font = '13px Arial';
      var y = 56, lh = 20;
      function line(k, v){ g.fillText(k + ' ' + v, 16, y); y += lh; }

      line('性別:', (function(){var n=document.getElementsByName('sex');for(var i=0;i<n.length;i++){if(n[i].checked)return (n[i].value==='male')?'男性':'女性';}return '女性';})());
      line('年齢:', document.getElementById('age').value + ' 歳');
      line('身長:', document.getElementById('height').value + ' cm');
      line('体重(実):', document.getElementById('weight').value + ' kg');
      line('血清Cr(使用):', document.getElementById('scrUsed').innerText + ' mg/dL');
      line('BMI:', document.getElementById('bmiVal').innerText + ' kg/m²');
      line('採用体重:', document.getElementById('wtUsedLabel').innerText + ' / ' + document.getElementById('wtUsedVal').innerText + ' kg');
      line('GFR(生値/使用):', document.getElementById('gfrRaw').innerText + ' / ' + document.getElementById('gfrUsed').innerText + ' mL/min');

      g.font = '16px Arial';
      g.fillStyle = '#000';
      g.fillText('投与量: ' + document.getElementById('doseMg').innerText + ' mg', 16, y + 10);

      g.font = '11px Arial';
      g.fillStyle = '#666';
      g.fillText('※ 機密情報の取り扱いに注意。', 16, h - 12);

      return c;
    }

    document.getElementById('btnSavePng').onclick = function(){
      var canvas = drawSummaryCanvas();
      if (canvas.msToBlob) {
        var blob = canvas.msToBlob();
        if (window.navigator && window.navigator.msSaveBlob) {
          window.navigator.msSaveBlob(blob, 'carboplatin_calc.png');
          toast('PNGを保存しました');
        } else {
          toast('保存に失敗（msSaveBlob未対応）');
        }
      } else {
        var url = canvas.toDataURL('image/png');
        window.open(url, '_blank');
        toast('新規タブの画像を手動で保存してください');
      }
    };

    document.getElementById('btnCopyImg').onclick = function(){
      try {
        var canvas = drawSummaryCanvas();
        var url = canvas.toDataURL('image/png');

        var box = document.createElement('div');
        box.contentEditable = 'true';
        box.style.position='fixed'; box.style.left='-9999px'; box.style.top='0';
        var img = document.createElement('img');
        img.src = url;
        box.appendChild(img);
        document.body.appendChild(box);

        var range = document.createRange();
        range.selectNodeContents(box);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }

        document.body.removeChild(box);
        if (ok) toast('「画像コピー」を試行しました（貼り付けて確認）');
        else toast('画像の直接コピーはIEでは失敗する場合があります。PNG保存をご利用ください。');
      } catch (e) {
        toast('画像コピーに失敗：PNG保存で代替してください');
      }
    };

    document.getElementById('btnCopyText').onclick = function(){
      var text = buildSummaryText();
      if (window.clipboardData && window.clipboardData.setData) {
        window.clipboardData.setData('Text', text);
        toast('テキストをコピーしました');
      } else {
        var ta = document.createElement('textarea');
        ta.style.position='fixed'; ta.style.left='-9999px'; ta.value = text;
        document.body.appendChild(ta); ta.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch(e){ ok = false; }
        document.body.removeChild(ta);
        toast(ok ? 'テキストをコピーしました' : 'コピーに失敗しました');
      }
    };
  };
})();
