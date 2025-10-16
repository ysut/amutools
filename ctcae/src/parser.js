(function(global){
  // ===== 仕様に合わせた堅牢パーサ（ES5） =====
  // 入力：MegaOaKの生テキスト
  // 出力：[{ name, value, unit, flag, section, line, raw_value }] （数値が取れない行は除外）
  // 既知のノイズ：先頭の「依頼元 …」、末尾の「付加コメント/依頼コメント/検体コメント」ブロック
  // 既知のフォーマット：1行1項目、列は“妙なスペース”で区切られる

  // 全角→半角の簡易正規化
  function z2h(s){
    if(s == null) return '';
    return String(s).replace(/[！-～]/g, function(ch){
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    }).replace(/　/g, ' ');
  }
  function normSpaces(s){
    // 普通/連続スペース・タブ・制御文字を単一スペースへ
    return s.replace(/[\u0000-\u001F]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '');
  }
  // 列スプリット（2個以上の空白 or タブで区切る）
  function smartSplit(line){
    // ただの split(/\s{2,}|\t+/) だと全角や混在で落ちることがあるので、
    // 先に全角→半角＋正規化した上で生行から位置対応は捨て、構造だけ抽出
    var n = normSpaces(z2h(line));
    // 見出しの [xxx] を1列として扱いたいので、まずはそのまま残す
    // 列は 2個以上の空白で分割（1個は単語内スペース扱い）
    return n.split(/ {2,}|\t+/);
  }

  // 先頭・末尾ノイズのカット：先頭は最初の "[xxx]" 行以降、末尾は「付加コメント/依頼コメント/検体コメント」以降を捨てる
  function trimNoise(lines){
    var start = 0, end = lines.length, i;
    var secHeadRe = /^\s*\d+\s*\[[^\]]+\]/; // 例: "014 [尿沈渣]"
    for(i=0;i<lines.length;i++){
      if(secHeadRe.test(lines[i])){ start = i; break; }
    }
    // 末尾はキーワードが出たらそこまで
    var tailStop = /^(付加コメント|依頼コメント|検体コメント)\s*$/;
    for(i=start;i<lines.length;i++){
      var x = normSpaces(z2h(lines[i]));
      if(tailStop.test(x)){ end = i; break; }
    }
    return lines.slice(start, end);
  }

  // 値部分から数値と単位/不等号を抽出
  // 例: ">100/H" "<0.1" "1.25" "9.9 L" "<50  外注" "（＋）" "(-)" など
  function parseValueCell(cell){
    var raw = z2h(cell);
    // まず目立つ判定記号
    var flag = null; // "H" / "L" / "N" など（必要なら拡張）
    if(/\bH\b/.test(raw)) flag = 'H';
    else if(/\bL\b/.test(raw)) flag = 'L';

    // "（＋）" "(+)" "(-)" は定性。数値は無いので value=null に
    if(/[（(]\s*[+\-＋－]\s*[)）]/.test(raw)) return { value: null, unit: null, flag: flag || null, raw_value: raw };

    // スラッシュ付き（">100/H" や "<1/H"）の手当：手前を値、後ろは unit として扱う
    var slash = raw.match(/([<>]=?)\s*([0-9.]+)\s*\/\s*([A-Za-z%μ\/]+)|([<>]=?)\s*([0-9.]+)/);
    if(slash){
      var cmp = slash[1] || slash[4], num = slash[2] || slash[5];
      var unit = slash[3] || null;
      return { value: parseFloat(num), unit: unit, cmp: cmp, flag: flag || null, raw_value: raw };
    }

    // 単純な数値＋任意の単位
    // 例: "9.9 L" "1.25" "<0.1" なども含むが、上の不等号にマッチしなければここで拾う
    var m = raw.match(/(-?\d+(?:\.\d+)?)/);
    var value = m ? parseFloat(m[1]) : null;

    // 単位の推定：数値の直後～行末の英字・記号をざっくり
    var unit = null;
    if(value != null){
      var idx = raw.indexOf(m[0]);
      var after = raw.slice(idx + m[0].length);
      var um = after.match(/^\s*([A-Za-z%μ\/]+)\b/);
      if(um) unit = um[1];
    }

    return { value: value, unit: unit, flag: flag || null, raw_value: raw };
  }

  // 項目名の正規化（英数は半角小文字化、日本語はそのまま）
  function normName(s){
    var t = z2h(s);
    t = t.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    var en = t.replace(/[A-Z]/g, function(ch){ return ch.toLowerCase(); });
    return en;
  }

  // セクション行か？
  function isSectionLine(line){
    return /^\s*\d+\s*\[[^\]]+\]/.test(line);
  }

  // 実パース本体
  function parseMegaOak(text){
    var lines = String(text).split(/\r?\n/);
    lines = trimNoise(lines);

    var out = [];
    var currentSection = null;

    for(var i=0;i<lines.length;i++){
      var raw = lines[i];
      if(!raw || !/\S/.test(raw)) continue;

      if(isSectionLine(raw)){
        // 例: "014 [尿沈渣]"
        var sec = raw.replace(/.*\[/, '').replace(/\].*/, '');
        currentSection = normSpaces(z2h(sec));
        continue;
      }

      // 列スプリット（2スペ以上/タブ）
      var cols = smartSplit(raw);
      if(!cols.length) continue;

      // 先頭に行番号（001など）が入っていれば捨てる
      if(/^\d{1,4}$/.test(cols[0])) cols.shift();

      // 期待フォーマット： [検査項目, 欲しい情報(=値セル), 異常ラベル, 備考] だが欠落・余分あり得る
      var name = cols[0] || '';
      var valueCell = cols[1] || '';
      var abnormal = cols[2] || '';
      var note = cols[3] || '';

      // 一部の表では「項目」「結果」ペア（尿沈渣など）が交互に出るので片側はスキップ
      // ここでは「結果」「項目」という固定語を持つ行はスキップし、次行の値で拾う簡易ロジック
      if(/^項目$/.test(normSpaces(z2h(name)))) continue;
      if(/^結果$/.test(normSpaces(z2h(name)))) continue;

      // 名前と値が逆転しているパターンへの救済：
      // 例: "Neut/μL          4.30" はOKだが、"4.30          Neut/μL" のような行は稀→検出して入替
      if(/^-?\d+(\.\d+)?/.test(normSpaces(z2h(name))) && !/^-?\d+(\.\d+)?/.test(normSpaces(z2h(valueCell)))){
        var tmp = name; name = valueCell; valueCell = tmp;
      }

      // 値セルを解析
      var pv = parseValueCell(valueCell);
      // 値が取れない行は無視（定性/陰性等は今回のCTCAE数値判定対象外）
      if(pv.value == null) continue;

      // 正規化したレコードを構築
      out.push({
        line: i,
        section: currentSection,
        name: normName(name),
        raw_name: name,
        value: pv.value,
        unit: pv.unit || null,
        flag: pv.flag || (abnormal ? normSpaces(z2h(abnormal)) : null),
        note: note ? normSpaces(z2h(note)) : null,
        raw_value: pv.raw_value
      });
    }

    return out;
  }

  global.MEGAOAK_PARSER = { parse: parseMegaOak };
})(this);
