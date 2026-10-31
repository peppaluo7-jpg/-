document.addEventListener("DOMContentLoaded", () => {
  const escHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[char]));

  const context = document.getElementById("target_context");
  if (context) context.innerHTML = [
    "美国英语语境", "英国英语语境", "中国香港英语语境", "新加坡英语语境",
    "中国普通话语境", "日本日语语境", "韩国韩语语境", "西班牙西语语境",
    "法国法语语境", "德国德语语境", "不确定 / 通用国际语境"
  ].map((label) => `<option>${label}</option>`).join("");

  const mail = document.getElementById("mailSec");
  const check = document.getElementById("checkSec");
  if (mail && check) check.insertAdjacentElement("afterend", mail);

  const sourcePanel = document.querySelector("aside > .panel");
  let preferencePanel;
  const contactsKey = "crossLanguageContacts.v1";
  let contacts;
  try { contacts = JSON.parse(localStorage.getItem(contactsKey)) || []; }
  catch (_) { contacts = []; }
  if (!Array.isArray(contacts)) contacts = [];
  contacts.forEach((contact) => {
    if (!contact.style) return;
    for (const key of ["directness","politeness","formality"]) {
      const value = Number(contact.style[key] ?? 3);
      contact.style[key] = value > 5 ? Math.max(1,Math.min(5,Math.round(value / 25) + 1)) : Math.max(1,Math.min(5,value));
    }
  });
  const preferencesKey = "crossLanguagePreferences.v1";
  const defaultPreferences = {choiceAmount:"single",editingDepth:"quick",requireReview:false,
    senderName:"",features:{translation:true,sentence:false,word:false,explanation:false}};
  let preferences;
  try { preferences = {...defaultPreferences,...JSON.parse(localStorage.getItem(preferencesKey) || "{}")}; }
  catch (_) { preferences = {...defaultPreferences}; }
  if (preferences.profile && !preferences.choiceAmount) {
    preferences.choiceAmount = preferences.profile === "refine" ? "single" : "compare";
    preferences.editingDepth = preferences.profile === "refine" ? "detailed" : "quick";
  }
  preferences.features = {...defaultPreferences.features,...preferences.features};
  delete preferences.profile;
  let activeContact = null;
  let saveContactStyle = false;
  let saveContactCulture = false;
  let lastAppliedCulture = null;
  const cultureKeys = ["directness","mitigation","apology","explanation","responsibility","commitment","hierarchy","relational_warmth"];
  const cultureNames = ["直接","缓和","道歉","解释","责任","承诺","层级","温度"];
  const cultureLevel = (value) => {
    const level = String(value && typeof value === "object" ? value.level || "" : value || "").toLowerCase();
    if (/very high|strong|extensive/.test(level)) return 5;
    if (/high|warm|detailed/.test(level)) return 4;
    if (/low|concise|minimal/.test(level)) return 2;
    if (/none|avoid|do_not/.test(level)) return 1;
    return 3;
  };
  const contactCulture = (contact) => {
    const saved = contact?.culture;
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(cultureKeys.filter((key) => Number.isInteger(saved[key]) && saved[key] >= 1 && saved[key] <= 5)
      .map((key) => [key,saved[key]]));
  };
  window.getContactCultureOverrides = () => contactCulture(activeContact);

  const saveContacts = () => {
    try {
      localStorage.setItem(contactsKey, JSON.stringify(contacts));
      document.dispatchEvent(new CustomEvent("shared-contacts-changed"));
      return true;
    }
    catch (_) { document.getElementById("contactHistory").textContent = "浏览器存储不可用，本次更改无法保存。"; return false; }
  };
  const safe = (value) => escHtml(value);
  let navigateStage = () => {};
  let refreshStages = () => {};
  let refreshReviewActions = () => {};
  let restoreActiveContact = () => {};
  const showPage = (page) => navigateStage(page === "home" ? "setup" : "results","expression");
  const contactMarkup = `
    <div class="contact-entry">
      <div class="eyebrow">先选联系人 · 自动载入沟通记忆</div>
      <div class="contact-entry-row">
        <label for="contactSelect">最近联系的人</label>
        <select id="contactSelect"><option value="">新联系人 / 暂不选择</option></select>
      </div>
      <div class="contact-recent" id="contactRecent"></div>
      <div class="contact-memory" id="contactMemory" aria-live="polite">选择联系人后载入关系、语境和默认表达尺度。</div>
      <details class="contact-add"><summary>添加联系人</summary>
        <div class="contact-add-fields"><input id="newContactName" placeholder="姓名或团队名称" aria-label="联系人名称">
          <select id="newContactRelation" aria-label="沟通关系"><option>导师 / 教授</option><option>同事</option><option>合作对象</option><option>上级</option><option>朋友</option><option value="custom">自定义</option></select>
          <input id="newContactCustomRelation" class="hidden" placeholder="填写沟通关系" aria-label="自定义沟通关系" maxlength="50">
          <input id="newContactTerms" placeholder="专属称呼或词汇，用逗号分隔（可选）" aria-label="专属称呼或词汇" maxlength="160">
          <button type="button" class="button secondary" id="addContact">添加</button></div>
      </details>
      <details class="contact-vocabulary hidden" id="contactVocabulary"><summary>专属词汇与称呼</summary>
        <div class="contact-vocabulary-row"><input id="contactTerms" placeholder="例如：Prof. Lee, Project Aurora" maxlength="160"><button type="button" class="button secondary" id="saveContactTerms">保存记忆</button></div>
      </details>
      <div class="contact-history" id="contactHistory"></div>
      <button type="button" class="contact-remove hidden" id="removeContact">删除此联系人及历史</button>
      <p class="contact-privacy">记忆仅保存在这台设备的浏览器中。</p>
    </div>`;
  const contactStyles = document.createElement("style");
  contactStyles.textContent = `
    .work-return{display:block;width:auto;margin:0 0 14px auto}
    .stage-nav{display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);background:var(--bg)}
    .stage-nav .button{width:auto;min-width:76px}.stage-nav .stage-jump{min-width:0;flex:1;font-size:12px;padding:9px}
    .stage-content{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:2px 3px 12px}
    .flow-page{display:flex;flex-direction:column;min-height:0}
    .flow-page [data-stage]:not(.is-current){display:none!important}
    .flow-page [data-stage].is-current{display:block!important}
    .stage-content .panel{margin:0 auto;width:100%;max-width:820px}
    .stage-content .panel#versionSec,.stage-content .panel#editStage{max-width:950px}
    .stage-content #pageHome,.stage-content #pageWork{min-height:0}
    #pageHome>aside,#pageWork>main{max-width:none;margin:0}
    #pageHome #confirmSec{margin-top:0}
    #pageWork main{display:contents}
    #pageWork .panel{margin:0 auto}
    .stage-nav .button{min-height:36px}
    #back{display:none!important}
    #editPreview{font-size:15px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f8f9ff;border:1px solid var(--line);border-radius:8px;margin-bottom:14px}
    #editPreview .word-token{cursor:pointer}
    .api-status{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:11px;margin-top:6px}
    .api-status:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
    .api-status.is-ai{color:#4f46e5}.api-status.is-demo{color:#b54708}
    .flow-page{animation:pageIn .24s ease-out}.flow-page.hidden{display:none!important}
    @keyframes pageIn{from{opacity:.6;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
    .preference-box{padding:17px;border:1px solid var(--line);border-radius:8px;background:#f8f9ff}
    .preference-box h3{margin:0 0 4px;font-size:14px}.preference-box p{margin:0 0 12px;color:var(--muted);font-size:11.5px;line-height:1.5}
    .preference-profiles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .preference-profile{position:relative;display:flex;gap:8px;padding:10px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer}
    .preference-profile:has(input:checked){border-color:#4f46e5;background:#eef2ff;box-shadow:0 0 0 2px #4f46e518}
    .preference-profile input{width:auto;align-self:flex-start;margin:2px 0 0}
    .preference-profile b{display:block;font-size:11.5px}.preference-profile small{display:block;margin-top:3px;color:var(--muted);font-size:10.5px;line-height:1.4}
    .preference-feature-list{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
    .preference-question{margin-top:14px}.preference-question>span{display:block;font-size:12px;font-weight:700;margin-bottom:7px}
    .preference-question select{max-width:100%}.review-preference{display:flex;align-items:center;gap:8px;margin-top:15px;font-size:12px}.review-preference input{width:auto;margin:0}
    .preference-feature{display:flex;align-items:center;gap:5px;padding:8px;border:1px solid var(--line);border-radius:7px;background:#fff;font-size:12px;color:#475467}
    .preference-feature input{width:auto;margin:0}
    .preference-summary{margin-top:9px;color:var(--muted);font-size:10.5px}
    .expression-source{padding:15px 17px;margin:0 0 16px;border-left:3px solid #4f46e5;background:#f8f9ff;border-radius:0 8px 8px 0}
    .expression-source h3{margin:0 0 6px;font-size:12px}.expression-source p{margin:0;color:#475467;font-size:13px;line-height:1.65;white-space:pre-wrap}
    .expression-translation{margin:8px 0 0;padding-top:8px;border-top:1px solid var(--line);color:#475467;font-size:12px;line-height:1.6}
    .version-translation{padding-top:10px!important;margin-top:10px!important;border-top:1px solid var(--line);color:#667085!important;font-size:12px!important}
    .translation-label{display:block;margin-bottom:4px;color:#4f46e5;font-size:11px;font-weight:700}
    .feature-hidden{display:none!important}
    .contact-entry{padding:16px;border:1px solid var(--line);border-radius:8px;background:#f8f9ff;margin-bottom:0}
    .contact-entry-row label{display:block;font-size:12px;font-weight:700;margin:0 0 7px;color:#344054}
    .contact-recent{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0}
    .contact-pill{border:1px solid var(--line-strong);background:#fff;border-radius:999px;padding:6px 10px;font-size:11px;cursor:pointer}
    .contact-pill[aria-pressed="true"]{border-color:#4f46e5;background:#eef2ff;color:#4338ca}
    .contact-memory{margin-top:11px;color:var(--muted);font-size:11.5px;line-height:1.5}
    .contact-history{font-size:11px;color:var(--muted);line-height:1.5;margin-top:7px}
    .contact-privacy{font-size:10.5px;color:#858b80;margin:10px 0 0}
    .contact-add{margin-top:12px;border-top:1px solid var(--line);padding-top:10px;font-size:11.5px;color:#475467}
    .contact-add summary{cursor:pointer;font-weight:650}
    .contact-add-fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:7px;margin-top:9px}
    .contact-add-fields #newContactCustomRelation{grid-column:1 / -1}
    .contact-add-fields #newContactTerms{grid-column:1 / 3}
    .contact-add-fields input,.contact-add-fields select{min-width:0;padding:8px;font-size:11px}
    .contact-add-fields .button{min-height:34px;padding:7px 10px;font-size:11px}
    .contact-vocabulary{margin-top:10px;border-top:1px solid var(--line);padding-top:10px;font-size:11.5px;color:#475467}
    .contact-vocabulary summary{cursor:pointer;font-weight:650}.contact-vocabulary-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin-top:9px}
    .contact-vocabulary-row input{min-width:0;padding:8px;font-size:11px}.contact-vocabulary-row .button{min-height:34px;padding:7px 10px;font-size:11px}
    .contact-remove{margin-top:9px;padding:0;border:0;background:transparent;color:#a73126;font-size:11px;cursor:pointer}
    .style-persistence{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 11px;margin:12px 0;background:#f8f9ff;border:1px solid var(--line);border-radius:8px;font-size:11.5px}
    .style-persistence label{display:flex;align-items:center;gap:5px;cursor:pointer}.style-persistence input{width:auto}
    .culture-persistence{margin:12px 0 0}.culture-persistence-note{width:100%;margin:0;color:var(--muted);font-size:11px;line-height:1.45}
    .culture-persistence input:disabled{cursor:not-allowed}.culture-persistence label:has(input:disabled){opacity:.5;cursor:not-allowed}
    .sentence-toolbar{position:fixed;z-index:9998;display:flex;gap:5px;padding:6px;background:#20211f;border-radius:9px;box-shadow:0 8px 24px #0003}
    .sentence-toolbar button{border:0;background:transparent;color:#fff;padding:7px 9px;border-radius:5px;font-size:11px;cursor:pointer}
    .sentence-toolbar button:hover,.sentence-toolbar button[aria-pressed="true"]{background:#41433e}
    .sentence-tone-options,.sentence-results{position:fixed;z-index:9999;width:min(440px,calc(100vw - 24px));max-height:min(55vh,440px);overflow:auto;background:white;border:1px solid var(--line-strong);border-radius:10px;padding:13px;box-shadow:0 14px 38px #10182833}
    .sentence-tone-options{display:flex;gap:6px;flex-wrap:wrap}.sentence-tone-options button,.sentence-result{border:1px solid var(--line);background:#fff;border-radius:7px;padding:8px 10px;font-size:11px;cursor:pointer}
    .sentence-results h3{font-size:12px;margin:0 0 9px}.sentence-result{display:block;width:100%;text-align:left;line-height:1.6;margin:7px 0}.sentence-result span{display:block;color:var(--accent);font-size:10px;margin-bottom:3px}
    .sentence-result:hover{border-color:#4f46e5;background:#f8f9ff}
    .sentence-status{font-size:11px;color:var(--muted);padding:5px}
    .sentence-toolbar.hidden{display:none!important}
    .version-toolbar{display:flex;gap:8px;margin:10px 0}.version-toolbar .button{width:auto}
    .version-translation{pointer-events:none}
    .sentence-result[disabled]{cursor:not-allowed;opacity:.55}
    body.single-version:not(.show-all-versions) .versions .version:not(.active){display:none!important}
    body.single-version .versions.choice-locked .version:not(.active){display:none!important}
    .editing-tools{padding:16px;margin:16px 0;border:1px solid var(--line);border-radius:8px;background:#fff}
    .editing-tools h3{font-size:15px;margin:0 0 4px}.editing-tools .edit-intro{font-size:12px;line-height:1.5;color:var(--muted);margin:0 0 12px}
    .edit-pane.hidden{display:none!important}.edit-pane label{display:block;color:#344054;font-size:12px;font-weight:700;margin:0 0 6px}
    .edit-pane select{margin-bottom:10px}.edit-pane .preview{padding:11px 12px;border:1px solid var(--line);background:#f8fafc;border-radius:7px;font-size:13px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
    .edit-commands{display:flex;flex-wrap:wrap;gap:7px;margin-top:11px}.edit-commands button{width:auto;min-height:35px;padding:7px 11px}
    .edit-result{margin-top:12px}.edit-result .sentence-result{border-color:var(--line-strong);font-size:12px}
    .edit-result .sentence-result strong{display:block;color:#4f46e5;margin-bottom:5px}
    .version-choice{width:auto;margin:0 0 10px}.edit-result .sentence-result{white-space:pre-wrap;overflow-wrap:anywhere}
    .edit-note{font-size:11px;color:var(--muted);line-height:1.5;margin:10px 0 0}
    .culture-narrative{font-size:12.5px;line-height:1.65;color:#475467;margin:9px 0 0}
    .culture-narrative strong{color:#4338ca}
    body.detailed-editing .edit-intro,body.detailed-editing .edit-note{display:none}
    .word-editor{border-radius:8px!important}.word-editor-topbar{border-radius:7px 7px 0 0!important;background:#34205f!important}
    .word-editor.is-collapsed{width:min(420px,calc(100vw - 24px))!important}.word-editor.is-collapsed .word-editor-topbar{border-radius:7px!important}
    .scale-reading{grid-column:2/-1;color:#4f46e5;font-size:11px;line-height:1.35;margin-top:-4px}
    .word-edit-hint{margin:9px 0 0;color:var(--muted);font-size:12px;line-height:1.5}
    :root{--bg:#f7f5fb;--ink:#241e32;--accent:#7045a2;--accent-strong:#54327e;--accent-soft:#eee6f7;--blue:#7045a2;--soft:#faf8fc;--line:#e7e0ee;--line-strong:#d4c8df}
    body{background:var(--bg)}.head:after{content:"Cultural communication";border-radius:7px}
    .panel,.version{border-radius:8px}.button,select,input:not([type="range"]),textarea{border-radius:7px}
    .button:hover:not(:disabled){box-shadow:0 2px 5px #4f46e533}
    .button.primary,.button{background:var(--accent);border-color:var(--accent);color:#fff}
    .button.secondary{background:#fff;border-color:var(--line-strong);color:var(--ink)}
    select:focus,input:not([type="range"]):focus,textarea:focus{border-color:#4f46e5;box-shadow:0 0 0 3px #4f46e526}
    .version.active,.versions.choice-locked .version.active{background:#fafaff;border-color:#4f46e5;box-shadow:0 0 0 2px #4f46e520}
    .version[data-k="direct"]:before{background:#4f46e5}.version[data-k="polite"]:before{background:#b07a31}.version[data-k="concise"]:before{background:#64748b}
    .word-token:hover,.word-token.is-open{background:var(--accent-soft);color:var(--accent-strong);box-shadow:none}
    #pageHome .panel:first-child{border-top:3px solid #4f46e5}
    #pageHome .field,#pageWork .field{min-width:0}
    .expression-source p,.version p,#finalBody{overflow-wrap:anywhere}
    .word-adjustments{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}
    .word-adjustments button{border:1px solid var(--line);background:#fff;border-radius:7px;padding:8px;font-size:11px;text-align:left;cursor:pointer}
    .word-adjustments button:hover{border-color:#4f46e5;background:#f8f7ff}
    .word-alternative-list{gap:7px}.word-alt{display:inline-flex;align-items:center;gap:4px;border-radius:7px;max-width:100%;white-space:normal;text-align:left;transition:none}
    .word-alt small{color:var(--accent);font-size:10.5px}.word-alt[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent-strong)}
    .word-sentence-label{display:block;margin:10px 0 4px;color:var(--muted);font-size:11px;font-weight:700}
    .word-original-sentence,.word-revised-sentence{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;font-size:13px}
    .word-original-sentence{color:var(--muted)}.word-revised-sentence{font-size:15px;color:var(--ink)}
    .word-grammar-note{margin:12px 0 0;padding:9px 10px;border-left:3px solid var(--accent);background:var(--accent-soft);color:#43375a;font-size:12px;line-height:1.55}
    .result-culture{margin-bottom:12px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#faf9ff;font-size:12px;line-height:1.5}
    .result-culture-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
    .result-culture-head .button{width:auto;min-height:30px;padding:5px 9px;font-size:11px}
    .result-culture p{margin:6px 0 0;color:var(--muted)}
    .meaning-facts{white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f8f7ff;border:1px solid var(--line);border-radius:7px;line-height:1.6;font-size:13px}
    .meaning-confirm{display:flex;align-items:flex-start;gap:8px;margin:13px 0;font-size:13px;line-height:1.5}.meaning-confirm input{width:auto;margin:2px 0}
    #apiWarning{margin-bottom:12px}
    #run{display:none}
    #extract{display:none}
    #pageWork .layout{display:block}
    #pageHome aside{position:static;max-height:none;overflow:visible;padding:0}
    #pageHome .actions{margin-top:16px}
    #pageHome #generateStatus{margin-top:9px}
    #pageWork .versions{grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))}
    #pageWork .version{min-height:0}
    #pageWork .version p{font-size:15px;line-height:1.8}
    .wrap{height:100dvh;min-height:420px;display:flex;flex-direction:column;overflow:hidden}
    .head:after{display:none}.head h1{letter-spacing:0}.section-title{letter-spacing:0}
    .head{flex:0 0 auto}.flow-page{flex:1}.stage-content{flex:1}.stage-nav{flex:0 0 auto}
    @media(max-width:620px){.preference-profiles{grid-template-columns:1fr}.contact-add-fields{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.contact-add-fields #addContact{grid-column:1 / -1}.edit-commands button{flex:1 1 auto}.wrap{padding:10px 12px}.head{margin-bottom:4px;padding-bottom:8px}.head h1{font-size:20px;margin-bottom:2px}.head .sub{font-size:11px;line-height:1.3}.panel{padding:14px}.preference-box{padding:12px}.preference-profile{padding:8px}.preference-profile small{margin-top:2px}.stage-nav .button{min-width:68px;padding:8px}}
  `;
  document.head.appendChild(contactStyles);
  const workspaceStyles = document.createElement("style");
  workspaceStyles.textContent = `
    :root{--bg:#edf1fb;--paper:#fff;--ink:#192244;--muted:#68738f;--line:#dbe2f3;--line-strong:#c9d3ec;--accent:#5658bc;--accent-strong:#3f43a0;--accent-soft:#e9eaff;--blue:#435cc3;--soft:#f5f7fd;--shadow:8px 10px 24px #25346b12,-5px -5px 18px #ffffffb8}
    html,body{background:#edf1fb;color:var(--ink)}
    .wrap{max-width:1680px;height:100dvh;min-height:400px;padding:16px 32px;overflow:hidden}
    .head{padding:0 4px 12px;margin:0;align-items:center;border-color:var(--line)}
    .head h1{font-size:21px;color:#26275e;margin:0}
    .panel{border-radius:8px;border:1px solid #ffffff;background:#fff;box-shadow:var(--shadow);padding:19px}
    .panel:before{pointer-events:none}
    .button,.button.primary{background:#555abe;border-color:#555abe;color:#fff;border-radius:8px;box-shadow:0 3px 8px #3f43a02a}
    .button:hover:not(:disabled),.button.primary:hover:not(:disabled){background:#4248a4;box-shadow:0 5px 12px #3f43a03a}
    .button.secondary{background:#f5f7ff;border-color:var(--line-strong);color:#353c7b;box-shadow:2px 3px 7px #27397612,-2px -2px 5px #fff}
    .button.secondary:hover:not(:disabled){background:#e9edff;color:#303684}
    select,input:not([type="range"]),textarea{border-color:var(--line-strong);border-radius:8px;background:#fbfcff;color:var(--ink)}
    select:focus,input:not([type="range"]):focus,textarea:focus{border-color:#6068ce;box-shadow:0 0 0 3px #6068ce26}
    .preference-box,.contact-entry,.style-persistence,.editing-tools,.expression-source,.meaning-facts,#editPreview,.result-culture{background:#f7f8ff;border-color:var(--line);border-radius:8px}
    #preferencePanel .preference-box,#contactPanel .contact-entry,#editStage .editing-tools{padding:0;border:0;background:transparent;box-shadow:none}
    #preferencePanel .preference-box p{margin-bottom:9px}
    #preferencePanel .preference-question{margin-top:11px}
    #contactPanel .contact-entry{margin:0}
    .preference-feature,.culture-chip,.version,.contact-pill{border-color:var(--line-strong);background:#fff}
    .preference-feature input,.review-preference input,.style-persistence input,.meaning-confirm input{accent-color:var(--accent)}
    .stage-nav{order:1;display:flex;flex-direction:column;align-items:stretch;width:100%;gap:8px;padding:12px 4px 10px;border:0;background:transparent}
    .stage-track{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;width:100%}
    .stage-item{min-width:0;text-align:left;display:flex;flex-direction:column;gap:7px;padding:0;border:0;background:transparent;color:#7e89a8;font-weight:650;font-size:12px;cursor:pointer;white-space:nowrap}
    .stage-item:before{content:"";height:4px;width:100%;border-radius:3px;background:#ced6ea;box-shadow:inset 0 1px 2px #24376a19}
    .stage-item.is-done:before{background:#686cd0}.stage-item.is-current:before{background:#ffe431;box-shadow:0 0 0 1px #f4cf22}
    .stage-item.is-current{color:#252867}.stage-item:disabled{opacity:.55;cursor:not-allowed}
    .stage-item:focus-visible{outline:2px solid #555abe;outline-offset:4px}
    .stage-content{order:2;flex:1;padding:4px 5px 12px;overflow-y:auto;overflow-x:hidden}
    .flow-page{min-height:0;display:block}.flow-page.hidden{display:none!important}
    .workspace-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px;align-items:start;width:100%;margin:0 auto}
    .mobile-sections{display:none}
    .workspace-grid>.panel,.result-views .panel{width:100%;max-width:none;margin:0}
    #pageCompose .workspace-grid{grid-template-columns:minmax(300px,1.12fr) minmax(300px,1.12fr) minmax(285px,.9fr)}
    .compose-details{display:contents}
    #pageCompose #confirmSec,#pageCompose #stylePanel{margin:0}
    #pageCompose #confirmSec .section-title{margin-bottom:8px}
    #pageCompose #confirmSec .notice{margin-bottom:10px}
    #pageCompose #stylePanel .range-row{margin:8px 0}
    #message{height:135px;min-height:110px}
    #resultStage{display:grid;grid-template-columns:minmax(290px,.82fr) minmax(400px,1.33fr);gap:15px;align-items:start;width:100%}
    #resultStage #cultureSec{grid-column:1}
    #resultStage #versionSec{grid-column:2}
    .refine-workspace{display:grid;grid-template-columns:minmax(400px,1.2fr) minmax(340px,1fr);gap:15px;align-items:start;width:100%}
    #resultStage .culture-summary{gap:5px}
    #resultStage .culture-chip{font-size:10px;padding:5px 6px}
    #resultStage .culture-helper,.culture-narrative{font-size:11px}
    #resultStage #versionSec .versions{grid-template-columns:minmax(0,1fr)}
    #resultStage .version{min-height:0}
    #resultStage .version p{font-size:13px;line-height:1.55}
    #reviewStage{display:grid;grid-template-columns:minmax(0,1fr);gap:15px;align-items:start}
    #reviewStage #meaningStage{margin:0}
    #pageDraft #mailSec{max-width:760px;margin:0 auto}
    #writeAnother{display:none;width:100%;margin-top:18px}
    #writeAnother.is-visible{display:block}
    #resultStage .panel,.refine-workspace .panel,.workspace-grid .panel{border-top:2px solid #dddffc}
    #pageSetup #preferencePanel,#pageCompose #messagePanel{border-top-color:#6b70ce}
    #inlineTone:not(.hidden){margin-top:14px;margin-bottom:10px}
    #finalBody{height:76px;min-height:76px;resize:none;overflow-y:hidden}
    .word-editor-topbar{background:#343982!important}
    .word-editor-topbar{cursor:grab;touch-action:none;user-select:none}
    .word-editor.is-dragging .word-editor-topbar{cursor:grabbing}
    .word-editor{width:min(560px,calc(100vw - 24px))!important;border-color:#8c95cf;box-shadow:0 16px 40px #28367136}
    #confirmVersion{display:block;width:100%;margin-top:12px}
    #changeVersion{margin:0 0 14px}
    .mobile-continue{display:none}
    #setupContinue,#prepareDraft,#quickPrepareDraft{margin-top:16px}
    .product-mode-nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:11px 4px 4px}
    .product-mode-button{min-width:0;border:1px solid var(--line-strong);border-radius:8px;background:#f7f8ff;color:#5f698a;padding:9px 12px;font-size:12px;font-weight:700;cursor:pointer}
    .product-mode-button:hover{border-color:#8991d6;background:#fff}.product-mode-button[aria-selected="true"]{border-color:#5658bc;background:#5658bc;color:#fff;box-shadow:0 4px 10px #3f43a02a}
    .lightweight-surface{order:2;flex:1;min-height:0;padding:10px 5px 12px;overflow:auto}.lightweight-surface.hidden{display:none!important}
    body[data-product-mode="embed"] .stage-nav,body[data-product-mode="embed"] .stage-content,
    body[data-product-mode="split"] .stage-nav,body[data-product-mode="split"] .stage-content{display:none!important}
    .product-demo{display:grid;gap:15px;min-height:0;align-items:start}.embed-demo{grid-template-columns:minmax(0,1fr)}
    .split-demo{grid-template-columns:minmax(460px,1fr) minmax(380px,.85fr)}
    .host-app,.light-agent{min-width:0;border:1px solid #fff;border-radius:10px;background:#fff;box-shadow:var(--shadow);overflow:hidden}
    .light-agent{position:static;top:auto;align-self:start;max-height:none;padding:0;overflow:visible}
    .embed-agent-popover{position:fixed;z-index:9997;top:118px;right:28px;width:min(390px,calc(100vw - 24px));max-height:calc(100dvh - 136px);display:flex;flex-direction:column;overflow:hidden;border-color:#9ca4df;box-shadow:0 20px 52px #20265d42}
    .embed-agent-popover.hidden{display:none!important}.embed-agent-popover .agent-bar{flex:0 0 auto;cursor:grab;touch-action:none;user-select:none}.embed-agent-popover.is-dragging .agent-bar{cursor:grabbing}
    .embed-agent-popover .agent-body{min-height:0;overflow:auto}.embed-agent-close{display:grid;place-items:center;width:28px;height:28px;margin-left:auto;border:0;border-radius:7px;background:transparent;color:#596284;font-size:20px;line-height:1;cursor:pointer}.embed-agent-close:hover{background:#e9eaff;color:#34398c}
    .embed-caret-trigger{position:fixed;z-index:9996;display:grid;place-items:center;width:25px;height:25px;padding:0;border:0;border-radius:7px;background:#6258c7;color:#fff;font-size:11px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px #3c33704d;animation:caretAgentIn .16s ease-out}.embed-caret-trigger:hover{background:#4942a9;transform:translateY(-1px)}.embed-caret-trigger.hidden{display:none!important}
    @keyframes caretAgentIn{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:scale(1)}}
    .host-bar,.agent-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:48px;padding:10px 15px;border-bottom:1px solid var(--line);background:#f8f9ff}
    .host-brand,.agent-brand{display:flex;align-items:center;gap:9px;font-size:13px;font-weight:750;color:#303574}.host-brand-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:7px;background:#5658bc;color:#fff;font-size:13px}
    .host-status{font-size:10.5px;color:var(--muted)}.mail-thread,.chat-thread{padding:18px;background:#f9faff;min-height:220px;max-height:39vh;overflow:auto}
    .mail-card{max-width:780px;margin:auto;padding:18px;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:0 3px 12px #2739760b}
    .mail-meta{display:flex;justify-content:space-between;gap:12px;margin-bottom:13px;color:var(--muted);font-size:11px}.mail-card h3{font-size:15px;margin:0 0 10px}.mail-card p{font-size:13px;line-height:1.7;margin:7px 0;color:#38415f}
    .mail-translation{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);color:#68738f;font-size:12px;line-height:1.75}.mail-translation b{display:block;margin-bottom:4px;color:#5658bc;font-size:10.5px}
    .host-composer{padding:14px 16px;border-top:1px solid var(--line);background:#fff}.host-composer textarea{min-height:84px;height:84px;resize:none}.composer-actions{display:flex;align-items:center;gap:8px;margin-top:9px}.composer-actions .button{width:auto;min-height:36px;padding:7px 12px}
    .embed-demo .host-composer{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:stretch}
    .embed-demo .host-composer textarea{height:auto;min-height:84px}
    .embed-demo .host-composer .composer-actions{display:contents}
    .embed-demo .host-composer .composer-actions .button{height:auto;min-height:38px}
    .embed-demo .host-composer .composer-actions .button:first-child{grid-column:1;grid-row:1;align-self:center}.embed-demo .host-composer textarea{grid-column:2;grid-row:1}.embed-demo .host-composer .composer-actions .button:nth-child(2){grid-column:3;grid-row:1;align-self:center}
    .agent-body{padding:16px}.agent-body .field{margin-bottom:12px}.agent-body textarea{min-height:82px;height:82px}.agent-memory{margin:8px 0 13px;padding:10px;border:1px solid var(--line);border-radius:7px;background:#f7f8ff;color:var(--muted);font-size:11px;line-height:1.55}
    .agent-quick-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}.agent-actions{display:flex;gap:8px}.agent-actions .button{flex:1}.light-status{min-height:18px;margin-top:8px;color:var(--muted);font-size:11px;line-height:1.5}
    .light-result{margin-top:12px;border:1px solid var(--line);border-radius:8px;background:#f8f9ff;overflow:hidden}.light-result.hidden{display:none!important}.light-result-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px;border-bottom:1px solid var(--line);font-size:11px;font-weight:700;color:#3b4180}.light-result-text{padding:12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.65;color:#28314e}.light-result-translation{padding:0 12px 12px;color:var(--muted);font-size:11px;line-height:1.55}.light-result-choices{display:flex;gap:5px}.light-choice{border:1px solid var(--line-strong);border-radius:6px;background:#fff;color:#596284;padding:5px 7px;font-size:10px;cursor:pointer}.light-choice.is-current{border-color:#5658bc;background:#e9eaff;color:#34398c}
    .split-result-popover{position:fixed;z-index:9997;right:28px;bottom:24px;width:min(430px,calc(100vw - 24px));max-height:min(560px,calc(100dvh - 36px));margin:0;display:flex;flex-direction:column;border-color:#9ca4df;background:#fff;box-shadow:0 20px 52px #20265d42}
    .split-result-popover .light-result-head{flex:0 0 auto;cursor:grab;touch-action:none;user-select:none;background:#f6f7ff}.split-result-popover.is-dragging .light-result-head{cursor:grabbing}.split-result-popover .light-result-text,.split-result-popover .light-result-translation{flex:0 0 auto}.split-result-popover .light-result-text{overflow:auto}.split-result-close{display:grid;place-items:center;width:25px;height:25px;padding:0;border:0;border-radius:6px;background:transparent;color:#596284;font-size:19px;line-height:1;cursor:pointer}.split-result-close:hover{background:#e9eaff;color:#34398c}.split-result-head-actions{display:flex;align-items:center;gap:7px;margin-left:auto}
    .chat-thread{display:flex;flex-direction:column;gap:10px;max-height:49vh}.chat-message{position:relative;max-width:82%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;color:#39425e;font-size:12px;line-height:1.6;cursor:pointer}.chat-message.mine{align-self:flex-end;background:#eceeff;border-color:#d4d8fa}.chat-message.is-synced{box-shadow:0 0 0 2px #5658bc}.chat-message input{position:absolute;right:7px;top:7px;width:auto;accent-color:#5658bc}.chat-message small{display:block;margin-bottom:3px;color:#79839f;font-size:9.5px}.sync-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}.sync-row .button{width:auto;min-height:34px;padding:7px 10px}.auto-sync{display:flex;align-items:center;gap:5px;margin-left:auto;font-size:10.5px;color:var(--muted)}.auto-sync input{width:auto;accent-color:#5658bc}
    .context-box{min-height:90px;padding:10px;border:1px solid var(--line);border-radius:7px;background:#f7f8ff;white-space:pre-wrap;overflow:auto;color:#4a5472;font-size:11px;line-height:1.55}
    @media(max-width:980px){.embed-demo,.split-demo{grid-template-columns:1fr}.mail-thread,.chat-thread{max-height:none}.product-mode-nav{grid-template-columns:1fr}.product-mode-button{padding:8px}.lightweight-surface{padding-top:6px}.embed-demo .host-composer{grid-template-columns:auto minmax(0,1fr) auto;gap:7px;padding:12px}.embed-demo .host-composer .composer-actions{display:contents}.embed-demo .host-composer .composer-actions .button{height:auto;min-width:0;padding:7px 9px}.embed-agent-popover{top:82px;right:12px;max-height:calc(100dvh - 94px)}.split-result-popover{right:12px;bottom:12px;max-height:calc(100dvh - 24px)}}
    @media(min-width:761px) and (max-width:1100px){
      #pageCompose .workspace-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
      #pageCompose #stylePanel{grid-column:1 / -1}
      #resultStage,.refine-workspace{grid-template-columns:repeat(2,minmax(0,1fr))}
    }
    @media(max-width:760px){
      .wrap{padding:9px 11px}.head{padding-bottom:7px}.head h1{font-size:18px}.head .sub{font-size:10px}
      .stage-nav{padding:9px 2px 8px;gap:7px}.stage-track{gap:5px}.stage-item{font-size:10px;gap:5px}
      .stage-content{padding:3px 2px 12px}.workspace-grid,#pageCompose .workspace-grid,#resultStage,.refine-workspace,#reviewStage{grid-template-columns:1fr;gap:10px}
      #pageCompose .compose-details{display:grid;gap:10px}
      .mobile-sections{display:flex;gap:4px;margin:0 0 9px;padding:3px;border:1px solid var(--line);border-radius:8px;background:#e8ecfa}
      .mobile-section-tab{flex:1;min-width:0;border:0;border-radius:6px;padding:8px 3px;background:transparent;color:#616c95;font-size:11px;font-weight:700;cursor:pointer}
      .mobile-section-tab[aria-selected="true"]{background:#fff;color:#393d99;box-shadow:1px 2px 5px #27397621}
      #pageSetup[data-mobile-view="preferences"] #contactPanel,#pageSetup[data-mobile-view="contacts"] #preferencePanel,
      #pageCompose[data-mobile-view="message"] .compose-details,#pageCompose[data-mobile-view="confirm"] #messagePanel,
      #pageCompose[data-mobile-view="confirm"] #stylePanel,#pageCompose[data-mobile-view="style"] #messagePanel,
      #pageCompose[data-mobile-view="style"] #confirmSec{display:none!important}
      #resultStage #cultureSec,#resultStage #versionSec{grid-column:auto}
      .panel{padding:14px}
      .mobile-continue{display:block;width:100%;margin-top:14px}
      .preference-box,.contact-entry{padding:12px}.preference-question{margin-top:10px}
      .preference-feature-list{gap:5px}.preference-feature{padding:6px;font-size:11px}
      .two{grid-template-columns:repeat(2,minmax(0,1fr))}.actions{flex-direction:row}
      .actions .button,.button.secondary{width:auto}
      #pageCompose #confirmSec .field{margin-bottom:10px}
      .word-editor{max-height:min(70dvh,520px)}
    }
  `;
  document.head.appendChild(workspaceStyles);

  if (sourcePanel) {
    preferencePanel = document.createElement("section");
    preferencePanel.className = "panel";
    preferencePanel.innerHTML = `
      <div class="eyebrow">设置你的偏好</div>
      <div class="section-title" id="preferenceHeading">你希望怎样获得帮助？</div>
      <section class="preference-box" aria-labelledby="preferenceHeading">
        <p>先填写你平时如何做决定；结果页会按偏好安排内容和工具。</p>
        <label class="preference-question"><span>希望一次看到几个候选？</span><select id="choiceAmount"><option value="single">先给我一个推荐表达</option><option value="compare">同时比较三个版本</option></select></label>
        <label class="preference-question"><span>修改时通常需要多深入？</span><select id="editingDepth"><option value="quick">尽快完成，少量修改</option><option value="detailed">逐句、逐词推敲</option></select></label>
        <label class="review-preference"><input type="checkbox" id="requireReview">重要内容先让我确认事实、立场和承诺</label>
        <div class="preference-feature-list">
          <label class="preference-feature"><input type="checkbox" data-feature="translation">生成表达的中文对照</label>
          <label class="preference-feature"><input type="checkbox" data-feature="explanation">句意解释</label>
          <label class="preference-feature"><input type="checkbox" data-feature="sentence">逐句修改</label>
          <label class="preference-feature"><input type="checkbox" data-feature="word">逐词修改</label>
        </div>
        <div class="preference-summary" id="preferenceSummary"></div>
      </section>`;
    sourcePanel.parentElement.insertBefore(preferencePanel,sourcePanel);
    const senderField = document.getElementById("sender_name").closest(".field");
    senderField.querySelector("label").textContent = "你的姓名（可选）";
    preferencePanel.querySelector(".preference-box").insertBefore(senderField,document.getElementById("choiceAmount").closest(".preference-question"));
    const receiverRow = document.getElementById("receiver_name").closest(".two");
    receiverRow.classList.remove("two");
    const senderName = document.getElementById("sender_name");
    senderName.value = preferences.senderName || "";
    const choiceAmount = document.getElementById("choiceAmount");
    const editingDepth = document.getElementById("editingDepth");
    const requireReview = document.getElementById("requireReview");
    const featureInputs = [...preferencePanel.querySelectorAll("[data-feature]")];
    const summary = document.getElementById("preferenceSummary");
    const refreshPreferenceSummary = () => {
      const labels = featureInputs.filter((input) => input.checked).map((input) => input.parentElement.textContent.trim());
      if (summary) summary.textContent = `${choiceAmount.value === "compare" ? "多版本对比" : "单一推荐"} · ${requireReview.checked ? "关键语义确认" : "无需额外确认"} · ${labels.join("、") || "轻量编辑"}`;
    };
    const persistPreferences = () => {
      preferences.choiceAmount = choiceAmount.value;
      preferences.editingDepth = editingDepth.value;
      preferences.requireReview = requireReview.checked;
      preferences.senderName = senderName.value.trim();
      preferences.features = Object.fromEntries(featureInputs.map((input) => [input.dataset.feature,input.checked]));
      try { localStorage.setItem(preferencesKey,JSON.stringify(preferences)); }
      catch (_) { if (summary) summary.textContent = "偏好仅在当前页面有效，浏览器存储不可用。"; }
      refreshPreferenceSummary();
      applyFeaturePreferences();
      refreshStages();
    };
    editingDepth.addEventListener("change",() => {
      for (const feature of featureInputs) if (["sentence","word"].includes(feature.dataset.feature)) feature.checked = editingDepth.value === "detailed";
      persistPreferences();
    });
    choiceAmount.addEventListener("change",persistPreferences);
    requireReview.addEventListener("change",persistPreferences);
    senderName.addEventListener("input",persistPreferences);
    featureInputs.forEach((input) => input.addEventListener("change",persistPreferences));
    choiceAmount.value = preferences.choiceAmount;
    editingDepth.value = preferences.editingDepth;
    requireReview.checked = !!preferences.requireReview;
    featureInputs.forEach((input) => { input.checked = !!preferences.features[input.dataset.feature]; });
    refreshPreferenceSummary();

    const layout = document.querySelector(".layout");
    const main = layout?.querySelector("main");
    if (layout && main) {
      const home = document.createElement("section");
      home.id = "pageHome";
      home.className = "flow-page";
      const work = document.createElement("section");
      work.id = "pageWork";
      work.className = "flow-page hidden";
      const back = document.createElement("button");
      back.type = "button";
      back.className = "button secondary work-return hidden";
      back.id = "pageBack";
      back.textContent = "返回首页";
      home.append(preferencePanel,layout.querySelector("aside"));
      work.append(back,main);
      layout.replaceWith(home,work);
      document.getElementById("run").style.display = "block";
      document.getElementById("extract").style.display = "block";
      document.getElementById("pageBack").addEventListener("click", () => showPage("home"));
      document.getElementById("run").textContent = "生成表达";
    }

    document.querySelectorAll(".eyebrow").forEach((label) => {
      label.textContent = label.textContent.replace(/^\d{2}\s*(?:[·.、]\s*)?/, "");
    });

    const scaleLabels = {
      directness:["非常含蓄","偏含蓄","平衡","较直接","非常直接"],
      politeness:["几乎无礼貌缓冲","较少缓冲","适中礼貌","较礼貌","高度礼貌"],
      formality:["非常随和","偏口语","中性","较正式","非常正式"]
    };
    const scaleEnds = {directness:"含蓄 → 直接",politeness:"直接 → 礼貌",formality:"随和 → 正式"};
    Object.entries(scaleLabels).forEach(([id,readings]) => {
      const input = document.getElementById(id);
      const reading = document.createElement("span");
      reading.className = "scale-reading";
      reading.id = `${id}Reading`;
      input.closest(".range-row").appendChild(reading);
      const update = () => {
        const level = Math.max(1,Math.min(5,Number(input.value)));
        reading.textContent = `${level} · ${readings[level - 1]}（1–5：${scaleEnds[id]}）`;
        input.setAttribute("aria-valuetext",readings[level - 1]);
      };
      input.addEventListener("input",update);
      update();
    });

    sourcePanel.insertAdjacentHTML("afterbegin", contactMarkup);
    const select = document.getElementById("contactSelect");
    const recent = document.getElementById("contactRecent");
    const memory = document.getElementById("contactMemory");
    const history = document.getElementById("contactHistory");
    const removeContact = document.getElementById("removeContact");
    const contactVocabulary = document.getElementById("contactVocabulary");
    const contactTerms = document.getElementById("contactTerms");
    const relationValues = ["导师 / 教授", "同事", "合作对象", "上级", "朋友"];
    const styleLabels = {formality:"正式", politeness:"友好", directness:"直接"};
    const newRelation = document.getElementById("newContactRelation");
    const customRelation = document.getElementById("newContactCustomRelation");
    newRelation.addEventListener("change", () => customRelation.classList.toggle("hidden",newRelation.value !== "custom"));

    const renderContacts = () => {
      const sorted = [...contacts].sort((a,b) => (b.lastUsed || 0) - (a.lastUsed || 0));
      select.innerHTML = '<option value="">新联系人 / 暂不选择</option>' + sorted.map((contact) => `<option value="${safe(contact.id)}">${safe(contact.name)}</option>`).join("");
      select.value = activeContact?.id || "";
      recent.innerHTML = sorted.slice(0,4).map((contact) => `<button class="contact-pill" type="button" data-contact="${safe(contact.id)}" aria-pressed="${activeContact?.id === contact.id}">${safe(contact.name)}</button>`).join("");
    };
    const renderContactDetails = (contact) => {
      const culture = contactCulture(contact);
      const cultureSummary = cultureKeys.filter((key) => key in culture)
        .map((key) => `${cultureNames[cultureKeys.indexOf(key)]} ${culture[key]}/5`).join(" · ");
      memory.innerHTML = `关系：${safe(contact.relation || "待确认")} · 常用语境：${safe(contact.context || "待确认")}<br>${contact.style ? `默认风格：${Object.entries(styleLabels).map(([key,label]) => `${label} ${Number(contact.style?.[key] || 3)}/5`).join(" · ")}` : "尚未保存默认风格"}<br>${cultureSummary ? `默认文化画像：${safe(cultureSummary)}` : "尚未保存默认文化画像"}`;
      const terms = Array.isArray(contact.terms) ? contact.terms.filter(Boolean) : [];
      contactVocabulary.classList.remove("hidden");
      contactTerms.value = terms.join(", ");
      history.innerHTML = `${terms.length ? `专属词汇：${terms.map(safe).join("、")}<br>` : ""}${Array.isArray(contact.history) && contact.history.length ? `最近沟通：${contact.history.slice(0,5).map((item) => `${safe(item.purpose)}（${new Date(item.at).toLocaleDateString("zh-CN")}）`).join("；")}` : "暂无历史沟通记录"}`;
      renderContacts();
    };
    const loadContact = (contact) => {
      activeContact = contact || null;
      select.value = contact?.id || "";
      saveContactStyle = false;
      saveContactCulture = false;
      lastAppliedCulture = null;
      removeContact.classList.toggle("hidden", !contact);
      const temporaryChoice = document.querySelector('input[name="stylePersistence"][value="temporary"]');
      if (temporaryChoice) temporaryChoice.checked = true;
      const cultureTemporary = document.querySelector('input[name="culturePersistence"][value="temporary"]');
      const cultureDefault = document.querySelector('input[name="culturePersistence"][value="default"]');
      if (cultureTemporary) cultureTemporary.checked = true;
      if (cultureDefault) cultureDefault.disabled = true;
      if (!contact) {
        contactVocabulary.classList.add("hidden");
        contactTerms.value = "";
        document.getElementById("receiver_name").value = "";
        const relation = document.getElementById("relation");
        relation.value = "";
        relation.dispatchEvent(new Event("change", {bubbles:true}));
        document.getElementById("custom_relation").value = "";
        document.getElementById("target_context").value = "美国英语语境";
        ["directness","politeness","formality"].forEach((id) => {
          const input = document.getElementById(id);
          input.value = id === "directness" ? "3" : "4";
          input.dispatchEvent(new Event("input", {bubbles:true}));
        });
        memory.textContent = "新联系人：确认关系与语境后即可开始。";
        history.textContent = "";
        renderContacts();
        return;
      }
      const receiver = document.getElementById("receiver_name");
      if (receiver) receiver.value = contact.name;
      const relation = document.getElementById("relation");
      if (relation) {
        relation.value = relationValues.includes(contact.relation) ? contact.relation : "custom";
        relation.dispatchEvent(new Event("change", {bubbles:true}));
      }
      if (relation?.value === "custom") document.getElementById("custom_relation").value = contact.relation;
      const contextSelect = document.getElementById("target_context");
      if (contextSelect && [...contextSelect.options].some((option) => option.value === contact.context)) contextSelect.value = contact.context;
      Object.entries(contact.style || {}).forEach(([key,value]) => {
        const input = document.getElementById(key);
        if (!input) return;
        input.value = String(Math.max(1,Math.min(5,Number(value) || 3)));
        input.dispatchEvent(new Event("input", {bubbles:true}));
      });
      renderContactDetails(contact);
    };
    restoreActiveContact = () => loadContact(activeContact);
    window.selectSharedContact = (id) => loadContact(contacts.find((contact) => contact.id === id) || null);
    window.getSharedContactState = () => ({contacts,activeContact,preferences});
    renderContacts();
    select.addEventListener("change", () => loadContact(contacts.find((contact) => contact.id === select.value) || null));
    recent.addEventListener("click", (event) => {
      const button = event.target.closest("[data-contact]");
      if (button) loadContact(contacts.find((contact) => contact.id === button.dataset.contact) || null);
    });
    document.getElementById("addContact").addEventListener("click", () => {
      const name = document.getElementById("newContactName").value.trim();
      if (!name) return document.getElementById("newContactName").focus();
      const relation = newRelation.value === "custom" ? customRelation.value.trim() : newRelation.value;
      if (!relation) { customRelation.focus(); return; }
      const terms = document.getElementById("newContactTerms").value.split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0,12);
      const contact = {id:globalThis.crypto?.randomUUID?.() || `contact-${Date.now()}`,name,relation,context:context.value,terms,history:[]};
      contacts.push(contact);
      saveContacts();
      document.getElementById("newContactName").value = "";
      document.getElementById("newContactTerms").value = "";
      customRelation.value = "";
      newRelation.value = relationValues[0];
      customRelation.classList.add("hidden");
      loadContact(contact);
    });
    document.getElementById("saveContactTerms").addEventListener("click", () => {
      if (!activeContact) return;
      activeContact.terms = contactTerms.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0,12);
      if (saveContacts()) renderContactDetails(activeContact);
    });
    removeContact.addEventListener("click", () => {
      if (!activeContact || !window.confirm(`删除“${activeContact.name}”及本机保存的沟通历史？`)) return;
      contacts = contacts.filter((item) => item.id !== activeContact.id);
      saveContacts();
      loadContact(null);
    });

    const confirm = document.getElementById("confirmSec");
    const confirmObserver = new MutationObserver(() => {
      if (!activeContact || confirm.classList.contains("hidden")) return;
      const receiver = document.getElementById("receiver_name");
      if (!receiver.value.trim()) receiver.value = activeContact.name;
      const relation = document.getElementById("relation");
      if (!relation.value) {
        relation.value = relationValues.includes(activeContact.relation) ? activeContact.relation : "custom";
        if (relation.value === "custom") document.getElementById("custom_relation").value = activeContact.relation;
        relation.dispatchEvent(new Event("change"));
      }
    });
    if (confirm) confirmObserver.observe(confirm, {attributes:true,attributeFilter:["class"]});

    const styleAnchor = confirm?.querySelector(".eyebrow");
    if (styleAnchor) {
      const persistence = document.createElement("div");
      persistence.className = "style-persistence";
      persistence.innerHTML = '<strong>本次表达风格</strong><label><input type="radio" name="stylePersistence" value="temporary" checked>仅本次生效</label><label><input type="radio" name="stylePersistence" value="default">保存为联系人默认</label>';
      const target = confirm.querySelector(".range-row")?.previousElementSibling || styleAnchor;
      target.insertAdjacentElement("afterend", persistence);
      persistence.addEventListener("change", (event) => { if (event.target.name === "stylePersistence") saveContactStyle = event.target.value === "default"; });
    }
    const culturePersistence = document.createElement("div");
    culturePersistence.className = "style-persistence culture-persistence";
    culturePersistence.innerHTML = '<strong>本次文化画像</strong><label><input type="radio" name="culturePersistence" value="temporary" checked>仅本次生效</label><label><input type="radio" name="culturePersistence" value="default" disabled>保存为联系人默认</label><p class="culture-persistence-note">保存已生成的画像；滑块调整需应用并重新生成后才更新默认值。</p>';
    document.getElementById("cultureSummary").insertAdjacentElement("afterend",culturePersistence);
    culturePersistence.addEventListener("change", (event) => {
      if (event.target.name !== "culturePersistence") return;
      saveContactCulture = event.target.value === "default";
      if (saveContactCulture && activeContact && lastAppliedCulture) {
        activeContact.culture = {...lastAppliedCulture};
        if (saveContacts()) renderContactDetails(activeContact);
      }
    });

    const pendingPurpose = () => {
      const purpose = document.getElementById("purpose");
      return purpose?.value === "custom" ? document.getElementById("custom_purpose").value.trim() : purpose?.value || "沟通";
    };
    document.addEventListener("generation-start", (event) => {
      event.detail.contactId = activeContact?.id || null;
      event.detail.contactTerms = Array.isArray(activeContact?.terms) ? [...activeContact.terms] : [];
      event.detail.contactHistory = Array.isArray(activeContact?.history) ? activeContact.history.slice(0,5) : [];
      event.detail.saveStyle = saveContactStyle;
      event.detail.saveCulture = saveContactCulture;
    });
    document.addEventListener("generation-complete", (event) => {
      const profile = window.__generatedCommunication?.culture?.profile || {};
      lastAppliedCulture = Object.fromEntries(cultureKeys.map((key) => [key,
        Number.isInteger(event.detail.culture?.[key]) ? event.detail.culture[key] : cultureLevel(profile[key])]));
      const cultureDefault = document.querySelector('input[name="culturePersistence"][value="default"]');
      if (cultureDefault) cultureDefault.disabled = !activeContact;
      const contact = contacts.find((item) => item.id === event.detail.contactId);
      if (!contact) return;
      contact.relation = event.detail.relation;
      contact.context = event.detail.context;
      if (event.detail.saveStyle) contact.style = event.detail.style;
      if (event.detail.saveCulture) contact.culture = {...lastAppliedCulture};
      if (!event.detail.isRevision) {
        contact.history = [{purpose:event.detail.purpose || pendingPurpose(),message:(event.detail.message || "").slice(0,320),at:Date.now()},...(Array.isArray(contact.history) ? contact.history : [])].slice(0,8);
      }
      contact.lastUsed = Date.now();
      if (saveContacts() && activeContact?.id === contact.id) renderContactDetails(contact);
    });
  }

  const versions = document.getElementById("versions");
  const versionSec = document.getElementById("versionSec");
  const finalBody = document.getElementById("finalBody");
  const editStatus = document.getElementById("editStatus");
  if (!versions || !versionSec || !finalBody) return;
  const resizeFinalBody = () => {
    if (!finalBody.getClientRects().length) return;
    const minHeight = 76;
    const maxHeight = Math.max(minHeight,Math.min(280,Math.round(window.innerHeight * .32)));
    finalBody.style.height = "auto";
    const naturalHeight = finalBody.scrollHeight;
    finalBody.style.height = `${Math.min(maxHeight,Math.max(minHeight,naturalHeight))}px`;
    finalBody.style.overflowY = naturalHeight > maxHeight ? "auto" : "hidden";
  };
  finalBody.addEventListener("input",resizeFinalBody);
  window.addEventListener("resize",resizeFinalBody);

  const cultureNarrative = document.createElement("p");
  cultureNarrative.className = "culture-narrative";
  document.querySelector("#cultureSec .culture-compact-head > div").appendChild(cultureNarrative);
  const editingTools = document.createElement("section");
  editingTools.className = "editing-tools";
  editingTools.innerHTML = `
    <h3>逐句修改</h3><p class="edit-intro">选择句子生成建议；前后文用于校对，修改由你确认后应用。</p>
    <div id="sentencePane" class="edit-pane">
      <label for="sentenceSelect">选择要修改的句子</label><select id="sentenceSelect"></select>
      <div class="preview" id="sentencePreview"></div>
      <div class="edit-commands"><button type="button" class="button secondary" data-inline-action="rewrite">重写</button><button type="button" class="button secondary" data-inline-action="shorten">精简</button><button type="button" class="button secondary" data-inline-action="tone">调整语气</button><button type="button" class="button secondary" data-inline-action="explain">解释句意</button></div>
      <select id="inlineTone" class="hidden" aria-label="选择语气"><option>更正式</option><option>更随和</option><option>更委婉</option><option>更直接</option></select>
      <p class="edit-note">仅更新所选句子，不改动前后文；也可在最终正文中划选短语后修改。</p>
    </div>
    <div id="inlineEditResult" class="edit-result" aria-live="polite"></div>`;
  finalBody.closest(".field").insertAdjacentElement("beforebegin",editingTools);
  const wordHint = document.createElement("p");
  wordHint.className = "word-edit-hint";
  wordHint.textContent = "逐词修改：点击上方生成表达中的词语，在弹窗中结合上下文调整整句。";
  versions.insertAdjacentElement("afterend",wordHint);
  const versionChoice = document.createElement("button");
  versionChoice.type = "button";
  versionChoice.className = "button secondary version-choice hidden";
  versionChoice.textContent = "查看其他表达版本";
  versions.insertAdjacentElement("beforebegin",versionChoice);
  versionChoice.addEventListener("click",() => {
    document.body.classList.toggle("show-all-versions");
    versionChoice.textContent = document.body.classList.contains("show-all-versions") ? "收起其他版本" : "查看其他表达版本";
  });
  const confirmVersion = document.createElement("button");
  confirmVersion.type = "button";
  confirmVersion.id = "confirmVersion";
  confirmVersion.className = "button primary";
  confirmVersion.textContent = "确认当前表达，继续修改与核对";
  versionSec.appendChild(confirmVersion);
  const home = document.getElementById("pageHome");
  const work = document.getElementById("pageWork");
  const workMain = work.querySelector("main");
  document.getElementById("emptySec")?.remove();
  const contactPanel = document.createElement("section");
  contactPanel.className = "panel";
  contactPanel.appendChild(document.querySelector(".contact-entry"));
  const stylePanel = document.createElement("section");
  stylePanel.className = "panel";
  const confirmPanel = document.getElementById("confirmSec");
  const scaleHeading = [...confirmPanel.children].find((element) => element.classList.contains("eyebrow") && element.textContent.includes("表达尺度"));
  for (let element = scaleHeading; element;) {
    const next = element.nextElementSibling;
    stylePanel.appendChild(element);
    element = next;
  }
  const resultStage = document.createElement("div");
  resultStage.id = "resultStage";
  const culturePanel = document.getElementById("cultureSec");
  resultStage.append(culturePanel,versionSec);
  const editStage = document.createElement("section");
  editStage.className = "panel";
  editStage.id = "editStage";
  editStage.innerHTML = '<div class="section-title">调整你选定的表达</div><p id="editPreview"></p>';
  editStage.append(editingTools,finalBody.closest(".field"),editStatus);
  editStage.querySelector("#editPreview").insertAdjacentElement("afterend",wordHint);
  const apiWarning = document.createElement("div");
  apiWarning.className = "notice hidden";
  apiWarning.id = "apiWarning";
  culturePanel.prepend(apiWarning);
  const meaningStage = document.createElement("section");
  meaningStage.className = "panel";
  meaningStage.id = "meaningStage";
  meaningStage.innerHTML = '<div class="eyebrow">关键语义</div><div class="section-title">发送前确认</div><p class="muted">检查生成表达是否符合你提供的事实与边界。</p><div class="meaning-facts" id="meaningFacts"></div><label class="meaning-confirm"><input type="checkbox" id="meaningAccepted">我已核对事实、立场和承诺，继续准备草稿</label><div class="status" id="meaningStatus"></div>';
  const checkPanel = document.getElementById("checkSec");
  const mailPanel = document.getElementById("mailSec");
  const prepareDraft = document.createElement("button");
  prepareDraft.type = "button";
  prepareDraft.id = "prepareDraft";
  prepareDraft.className = "button primary hidden";
  prepareDraft.textContent = "准备草稿";
  meaningStage.appendChild(prepareDraft);
  const quickPrepareDraft = document.createElement("button");
  quickPrepareDraft.type = "button";
  quickPrepareDraft.id = "quickPrepareDraft";
  quickPrepareDraft.className = "button primary";
  quickPrepareDraft.textContent = "准备草稿";
  checkPanel.appendChild(quickPrepareDraft);
  document.querySelector("#checkSec .eyebrow").textContent = "生成时风险自检 · 请人工核对";
  home.id = "pageSetup";
  home.dataset.stage = "setup";
  home.dataset.mobileView = "preferences";
  home.classList.add("workspace-grid");
  preferencePanel.id = "preferencePanel";
  contactPanel.id = "contactPanel";
  const setupSwitch = document.createElement("div");
  setupSwitch.className = "mobile-sections";
  setupSwitch.setAttribute("role","tablist");
  setupSwitch.setAttribute("aria-label","偏好与联系人");
  setupSwitch.innerHTML = '<button type="button" role="tab" class="mobile-section-tab" data-mobile-section="preferences">偏好设置</button><button type="button" role="tab" class="mobile-section-tab" data-mobile-section="contacts">联系人</button>';
  home.replaceChildren(setupSwitch,preferencePanel,contactPanel);
  const preferencesContinue = document.createElement("button");
  preferencesContinue.type = "button";
  preferencesContinue.id = "preferencesContinue";
  preferencesContinue.className = "button secondary mobile-continue";
  preferencesContinue.textContent = "继续填写联系人";
  preferencePanel.appendChild(preferencesContinue);
  const setupContinue = document.createElement("button");
  setupContinue.type = "button";
  setupContinue.id = "setupContinue";
  setupContinue.className = "button primary";
  setupContinue.textContent = "填写沟通内容";
  contactPanel.appendChild(setupContinue);
  const compose = document.createElement("section");
  compose.id = "pageCompose";
  compose.dataset.stage = "compose";
  compose.dataset.mobileView = "message";
  compose.className = "flow-page hidden";
  const composeSwitch = document.createElement("div");
  composeSwitch.className = "mobile-sections";
  composeSwitch.setAttribute("role","tablist");
  composeSwitch.setAttribute("aria-label","沟通内容与确认");
  composeSwitch.innerHTML = '<button type="button" role="tab" class="mobile-section-tab" data-mobile-section="message">沟通内容</button><button type="button" role="tab" class="mobile-section-tab" data-mobile-section="confirm">信息确认</button><button type="button" role="tab" class="mobile-section-tab" data-mobile-section="style">表达尺度</button>';
  const composeGrid = document.createElement("div");
  composeGrid.className = "workspace-grid";
  composeGrid.id = "composeGrid";
  const composeDetails = document.createElement("div");
  composeDetails.className = "compose-details";
  sourcePanel.id = "messagePanel";
  stylePanel.id = "stylePanel";
  stylePanel.classList.add("hidden");
  composeDetails.append(confirmPanel,stylePanel);
  composeGrid.append(sourcePanel,composeDetails);
  compose.append(composeSwitch,composeGrid);
  const confirmContinue = document.createElement("button");
  confirmContinue.type = "button";
  confirmContinue.id = "confirmContinue";
  confirmContinue.className = "button secondary mobile-continue";
  confirmContinue.textContent = "继续调整表达尺度";
  confirmPanel.appendChild(confirmContinue);
  work.id = "pageResults";
  work.dataset.stage = "results";
  workMain.replaceChildren();
  const resultViews = document.createElement("div");
  resultViews.className = "result-views";
  const reviewStage = document.createElement("div");
  reviewStage.id = "reviewStage";
  reviewStage.append(checkPanel,meaningStage);
  resultViews.append(resultStage);
  workMain.append(resultViews);
  const refine = document.createElement("section");
  refine.id = "pageRefine";
  refine.dataset.stage = "refine";
  refine.className = "flow-page hidden";
  const refineWorkspace = document.createElement("div");
  refineWorkspace.className = "refine-workspace";
  const changeVersion = document.createElement("button");
  changeVersion.type = "button";
  changeVersion.id = "changeVersion";
  changeVersion.className = "button secondary";
  changeVersion.textContent = "重新选择表达版本";
  editStage.querySelector(".section-title").insertAdjacentElement("afterend",changeVersion);
  refineWorkspace.append(editStage,reviewStage);
  refine.append(refineWorkspace);
  const draft = document.createElement("section");
  draft.id = "pageDraft";
  draft.dataset.stage = "draft";
  draft.className = "flow-page hidden";
  const writeAnother = document.createElement("button");
  writeAnother.id = "writeAnother";
  writeAnother.type = "button";
  writeAnother.className = "button secondary";
  writeAnother.textContent = "再写一份";
  mailPanel.appendChild(writeAnother);
  draft.appendChild(mailPanel);
  const stages = [
    ["setup","偏好与联系人",home],
    ["compose","内容与确认",compose],
    ["results","画像与表达",work],
    ["refine","局部修改与核对",refine],
    ["draft","邮箱草稿",draft]
  ];
  const shortStageLabels = {setup:"偏好",compose:"内容",results:"表达",refine:"修改",draft:"草稿"};
  const content = document.createElement("div");
  content.className = "stage-content";
  home.parentElement.insertBefore(content,home);
  content.append(home,compose,work,refine,draft);
  const stageNav = document.createElement("nav");
  stageNav.className = "stage-nav";
  stageNav.setAttribute("aria-label","进度与页面跳转");
  stageNav.innerHTML = `<div class="stage-track">${stages.map(([id,label],index) => `<button type="button" class="stage-item" data-jump="${id}" aria-label="第${index + 1}步：${label}"><span>${String(index + 1).padStart(2,"0")} · ${shortStageLabels[id]}</span></button>`).join("")}</div>`;
  content.insertAdjacentElement("beforebegin",stageNav);

  const modeNav = document.createElement("nav");
  modeNav.className = "product-mode-nav";
  modeNav.setAttribute("aria-label","产品形态");
  modeNav.innerHTML = `
    <button type="button" class="product-mode-button" data-product-mode="web">独立网页端</button>
    <button type="button" class="product-mode-button" data-product-mode="embed">浏览器 / 客户端内嵌</button>
    <button type="button" class="product-mode-button" data-product-mode="split">双窗口关联联动</button>`;
  document.querySelector(".head").insertAdjacentElement("afterend",modeNav);

  const embedSurface = document.createElement("section");
  embedSurface.id = "embedSurface";
  embedSurface.className = "lightweight-surface hidden";
  embedSurface.innerHTML = `
    <div class="product-demo embed-demo">
      <section class="host-app" aria-label="模拟邮件客户端">
        <div class="host-bar"><div class="host-brand"><span class="host-brand-mark">M</span><span>Mail · 项目往来</span></div><span class="host-status">内嵌 Agent 演示</span></div>
        <div class="mail-thread" id="embedMailThread"><article class="mail-card">
          <div class="mail-meta"><span>Alex Morgan &lt;alex@example.com&gt;</span><span>今天 09:42</span></div>
          <h3>Project timeline</h3>
          <p>Hi, could you confirm whether the revised project timeline still works for your team?</p>
          <p>We would appreciate an update before Friday so we can coordinate the next review.</p>
          <div class="mail-translation"><b>中文翻译</b>你好，请确认修改后的项目时间表是否仍适合你们团队。希望能在周五之前收到更新，以便我们协调下一次评审。</div>
        </article></div>
        <div class="host-composer"><textarea id="embedReply" placeholder="在这里回复邮件…"></textarea><div class="composer-actions"><button type="button" class="button secondary">附件</button><button type="button" class="button secondary">发送</button></div></div>
      </section>
      <button type="button" class="embed-caret-trigger hidden" id="embedCaretTrigger" aria-label="打开 Cross Language 助手" aria-expanded="false" title="打开 Cross Language 助手">C</button>
      <aside class="light-agent embed-agent-popover hidden" id="embedAgentPopover" aria-label="内嵌 Cross Language 助手">
        <div class="agent-bar"><div class="agent-brand"><span class="host-brand-mark">C</span><span>Cross Language</span></div><button type="button" class="embed-agent-close" id="embedAgentClose" aria-label="关闭助手">×</button></div>
        <div class="agent-body">
          <div class="field"><label>沟通对象</label><select id="embedContact"></select></div>
          <div class="agent-memory" id="embedMemory"></div>
          <div class="field"><label>这次希望怎么回复？</label><textarea id="embedInstruction" placeholder="例如：确认收到，并说明明天下午给出时间表"></textarea></div>
          <div class="agent-quick-row"><div class="field"><label>目的</label><select id="embedPurpose"><option>解释 / 进度说明</option><option>请求 / 申请</option><option>表达不同意见</option><option>拒绝</option><option>提醒</option><option>道歉</option></select></div><div class="field"><label>语境</label><select id="embedContext"><option>美国英语语境</option><option>英国英语语境</option><option>不确定 / 通用国际语境</option></select></div></div>
          <div class="agent-actions"><button type="button" class="button primary" id="embedGenerate">生成可回填表达</button></div>
          <div class="light-status" id="embedStatus">选择邮件文字或直接描述回复目的。</div>
          <div class="light-result hidden" id="embedResult"><div class="light-result-head"><span>表达建议</span><div class="light-result-choices"></div></div><div class="light-result-text"></div><div class="light-result-translation"></div><div class="agent-actions" style="padding:0 12px 12px"><button type="button" class="button primary" data-fill="embed">回填邮件输入框</button><button type="button" class="button secondary" data-copy="embed">复制</button></div></div>
        </div>
      </aside>
    </div>`;

  const splitSurface = document.createElement("section");
  splitSurface.id = "splitSurface";
  splitSurface.className = "lightweight-surface hidden";
  splitSurface.innerHTML = `
    <div class="product-demo split-demo">
      <section class="host-app" aria-label="原沟通窗口">
        <div class="host-bar"><div class="host-brand"><span class="host-brand-mark">C</span><span>团队聊天 · Aurora 项目</span></div><span class="host-status">原沟通窗口</span></div>
        <div class="chat-thread" id="splitThread">
          <label class="chat-message"><small>Alex · 昨天 16:20</small><input type="checkbox" checked>Could we move the design review to Thursday morning?</label>
          <label class="chat-message mine"><small>我 · 昨天 16:32</small><input type="checkbox" checked>I will check with the team and get back to you.</label>
          <label class="chat-message"><small>Alex · 今天 09:15</small><input type="checkbox" checked>Thanks. We need to book the room by noon today.</label>
        </div>
        <div class="host-composer"><textarea id="splitReply" placeholder="原平台的消息输入框…"></textarea><div class="composer-actions"><button type="button" class="button secondary" id="addSplitMessage">添加一轮历史</button><button type="button" class="button primary">发送</button></div></div>
      </section>
      <aside class="light-agent" aria-label="联动 Cross Language 助手">
        <div class="agent-bar"><div class="agent-brand"><span class="host-brand-mark">C</span><span>Cross Language · 联动窗口</span></div><span class="host-status" id="splitSyncBadge">已同步 3 条</span></div>
        <div class="agent-body">
          <div class="field"><label>沟通对象</label><select id="splitContact"></select></div>
          <div class="agent-memory" id="splitMemory"></div>
          <div class="sync-row"><button type="button" class="button secondary" id="syncContext">同步选中上下文</button><label class="auto-sync"><input type="checkbox" id="autoSync" checked>自动同步</label></div>
          <div class="field"><label>已同步的多轮上下文</label><div class="context-box" id="syncedContext"></div></div>
          <div class="field"><label>这次要表达什么？</label><textarea id="splitInstruction" placeholder="例如：周四上午可以，但希望十点以后"></textarea></div>
          <div class="agent-actions"><button type="button" class="button primary" id="splitGenerate">结合历史生成</button></div>
          <div class="light-status" id="splitStatus">勾选左侧消息后可自动同步。</div>
          <div class="light-result split-result-popover hidden" id="splitResult"><div class="light-result-head"><span>上下文适配表达</span><div class="split-result-head-actions"><div class="light-result-choices"></div><button type="button" class="split-result-close" id="splitResultClose" aria-label="关闭表达结果">×</button></div></div><div class="light-result-text"></div><div class="light-result-translation"></div><div class="agent-actions" style="padding:0 12px 12px"><button type="button" class="button primary" data-fill="split">回填原窗口</button><button type="button" class="button secondary" data-copy="split">复制</button></div></div>
        </div>
      </aside>
    </div>`;
  document.querySelector(".wrap").append(embedSurface,splitSurface);

  const modeKey = "crossLanguageProductMode.v1";
  const setProductMode = (mode) => {
    if (!["web","embed","split"].includes(mode)) mode = "web";
    document.body.dataset.productMode = mode;
    embedSurface.classList.toggle("hidden",mode !== "embed");
    splitSurface.classList.toggle("hidden",mode !== "split");
    if (mode !== "embed") {
      document.getElementById("embedCaretTrigger")?.classList.add("hidden");
      document.getElementById("embedAgentPopover")?.classList.add("hidden");
    }
    modeNav.querySelectorAll("[data-product-mode]").forEach((button) => button.setAttribute("aria-selected",String(button.dataset.productMode === mode)));
    if (mode !== "web" && typeof refreshLightContacts === "function") refreshLightContacts();
    try { localStorage.setItem(modeKey,mode); } catch (_) { /* Mode remains available for this session. */ }
  };
  modeNav.addEventListener("click",(event) => {
    const button = event.target.closest("[data-product-mode]");
    if (button) setProductMode(button.dataset.productMode);
  });

  const sharedContactOptions = () => '<option value="">暂不使用联系人记忆</option>' + contacts.map((contact) => `<option value="${safe(contact.id)}">${safe(contact.name)}</option>`).join("");
  const sharedMemoryText = () => {
    if (!activeContact) return "未选择联系人，将按本次内容生成。";
    const terms = Array.isArray(activeContact.terms) && activeContact.terms.length ? ` · 专属词汇：${activeContact.terms.join("、")}` : "";
    const turns = Array.isArray(activeContact.history) ? activeContact.history.length : 0;
    return `${activeContact.name} · ${activeContact.relation || "关系待确认"} · 已记忆 ${turns} 次往来${terms}`;
  };
  const refreshLightContacts = () => {
    for (const id of ["embedContact","splitContact"]) {
      const select = document.getElementById(id);
      const value = activeContact?.id || "";
      select.innerHTML = sharedContactOptions();
      select.value = value;
    }
    document.getElementById("embedMemory").textContent = sharedMemoryText();
    document.getElementById("splitMemory").textContent = sharedMemoryText();
    if (activeContact?.context) document.getElementById("embedContext").value = [...document.getElementById("embedContext").options].some((option) => option.value === activeContact.context) ? activeContact.context : "不确定 / 通用国际语境";
  };
  ["embedContact","splitContact"].forEach((id) => document.getElementById(id).addEventListener("change",(event) => {
    window.selectSharedContact?.(event.target.value);
    refreshLightContacts();
  }));
  document.addEventListener("shared-contacts-changed",refreshLightContacts);
  refreshLightContacts();

  const embedReply = document.getElementById("embedReply");
  const embedTrigger = document.getElementById("embedCaretTrigger");
  const embedPopover = document.getElementById("embedAgentPopover");
  const clampEmbedOverlay = (node,left,top) => ({
    left:Math.max(12,Math.min(left,window.innerWidth - node.offsetWidth - 12)),
    top:Math.max(12,Math.min(top,window.innerHeight - node.offsetHeight - 12))
  });
  const textareaCaretPoint = (field) => {
    const style = getComputedStyle(field);
    const mirror = document.createElement("div");
    for (const property of ["boxSizing","width","height","paddingTop","paddingRight","paddingBottom","paddingLeft","borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth","fontFamily","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","textTransform","textIndent","whiteSpace","wordBreak","overflowWrap","tabSize"]) mirror.style[property] = style[property];
    mirror.style.position = "fixed";
    mirror.style.left = `${field.getBoundingClientRect().left}px`;
    mirror.style.top = `${field.getBoundingClientRect().top}px`;
    mirror.style.visibility = "hidden";
    mirror.style.overflow = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.textContent = field.value.slice(0,field.selectionStart).replace(/\n$/,"\n\u200b");
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const fieldRect = field.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const point = {left:markerRect.left - field.scrollLeft,top:markerRect.top - field.scrollTop,height:parseFloat(style.lineHeight) || 20};
    mirror.remove();
    if (point.left < fieldRect.left || point.left > fieldRect.right || point.top < fieldRect.top || point.top > fieldRect.bottom) return {left:fieldRect.right - 34,top:fieldRect.bottom - 34,height:20};
    return point;
  };
  const placeEmbedTrigger = (point) => {
    const placed = clampEmbedOverlay(embedTrigger,point.left + 5,point.top + point.height - 5);
    embedTrigger.style.left = `${placed.left}px`;
    embedTrigger.style.top = `${placed.top}px`;
  };
  const showEmbedTriggerAtCaret = () => {
    if (document.body.dataset.productMode !== "embed" || !embedPopover.classList.contains("hidden")) return;
    embedTrigger.classList.remove("hidden");
    placeEmbedTrigger(textareaCaretPoint(embedReply));
  };
  const closeEmbedAgent = ({restoreTrigger=true}={}) => {
    embedPopover.classList.add("hidden");
    embedTrigger.setAttribute("aria-expanded","false");
    if (restoreTrigger && document.body.dataset.productMode === "embed") {
      embedReply.focus();
      requestAnimationFrame(showEmbedTriggerAtCaret);
    } else embedTrigger.classList.add("hidden");
  };
  const openEmbedAgent = () => {
    embedTrigger.classList.add("hidden");
    embedTrigger.setAttribute("aria-expanded","true");
    embedPopover.classList.remove("hidden");
    if (embedPopover.dataset.dragged !== "true") {
      embedPopover.style.left = "";
      embedPopover.style.top = window.innerWidth <= 980 ? "82px" : "118px";
      embedPopover.style.right = window.innerWidth <= 980 ? "12px" : "28px";
    }
    const instruction = document.getElementById("embedInstruction");
    if (embedSelection) instruction.value = `请结合邮件上下文处理这段选中文字：${embedSelection}`;
    instruction.focus();
    document.getElementById("embedStatus").textContent = embedSelection ? "已读取选中文字，可补充具体修改要求。" : "已读取当前邮件，可描述你希望如何回复。";
  };
  embedTrigger.addEventListener("pointerdown",(event) => event.stopPropagation());
  embedTrigger.addEventListener("click",openEmbedAgent);
  document.getElementById("embedAgentClose").addEventListener("click",() => closeEmbedAgent());
  for (const eventName of ["focus","input","click","keyup","select","scroll"]) embedReply.addEventListener(eventName,showEmbedTriggerAtCaret);
  window.addEventListener("resize",() => {
    if (!embedTrigger.classList.contains("hidden")) showEmbedTriggerAtCaret();
    if (!embedPopover.classList.contains("hidden") && embedPopover.dataset.dragged === "true") {
      const rect = embedPopover.getBoundingClientRect();
      const placed = clampEmbedOverlay(embedPopover,rect.left,rect.top);
      embedPopover.style.left = `${placed.left}px`;embedPopover.style.top = `${placed.top}px`;embedPopover.style.right = "auto";
    }
  });
  let embedDrag = null;
  embedPopover.addEventListener("pointerdown",(event) => {
    if (event.button !== 0 || !event.target.closest(".agent-bar") || event.target.closest(".embed-agent-close")) return;
    const rect = embedPopover.getBoundingClientRect();
    embedDrag = {id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
    embedPopover.setPointerCapture(event.pointerId);
    embedPopover.classList.add("is-dragging");
    event.preventDefault();
  });
  embedPopover.addEventListener("pointermove",(event) => {
    if (!embedDrag || event.pointerId !== embedDrag.id) return;
    const placed = clampEmbedOverlay(embedPopover,embedDrag.left + event.clientX - embedDrag.x,embedDrag.top + event.clientY - embedDrag.y);
    embedPopover.dataset.dragged = "true";
    embedPopover.style.left = `${placed.left}px`;embedPopover.style.top = `${placed.top}px`;embedPopover.style.right = "auto";
  });
  const finishEmbedDrag = (event) => {
    if (!embedDrag || event.pointerId !== embedDrag.id) return;
    embedDrag = null;embedPopover.classList.remove("is-dragging");
    if (embedPopover.hasPointerCapture(event.pointerId)) embedPopover.releasePointerCapture(event.pointerId);
  };
  embedPopover.addEventListener("pointerup",finishEmbedDrag);
  embedPopover.addEventListener("pointercancel",finishEmbedDrag);

  let embedSelection = "";
  document.addEventListener("selectionchange",() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || document.body.dataset.productMode !== "embed") return;
    const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
    const selected = selection.toString().trim();
    if (selected && embedSurface.contains(anchor) && !embedPopover.contains(anchor)) {
      embedSelection = selected.slice(0,1500);
      if (embedPopover.classList.contains("hidden")) {
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        embedTrigger.classList.remove("hidden");
        placeEmbedTrigger({left:rect.right,top:rect.bottom,height:0});
      }
    }
  });

  const syncSplitContext = () => {
    const chosen = [...document.querySelectorAll("#splitThread .chat-message")].filter((message) => message.querySelector("input").checked);
    document.querySelectorAll("#splitThread .chat-message").forEach((message) => message.classList.toggle("is-synced",message.querySelector("input").checked));
    document.getElementById("syncedContext").textContent = chosen.map((message) => `${message.querySelector("small").textContent}\n${message.childNodes[message.childNodes.length - 1].textContent.trim()}`).join("\n\n") || "尚未选择上下文";
    document.getElementById("splitSyncBadge").textContent = `已同步 ${chosen.length} 条`;
    document.getElementById("splitStatus").textContent = chosen.length ? "上下文已同步，生成时会结合双方历史语气。" : "请至少选择一条消息。";
  };
  document.getElementById("syncContext").addEventListener("click",syncSplitContext);
  document.getElementById("splitThread").addEventListener("change",() => { if (document.getElementById("autoSync").checked) syncSplitContext(); });
  document.getElementById("addSplitMessage").addEventListener("click",() => {
    const input = document.getElementById("splitReply");
    if (!input.value.trim()) return input.focus();
    const message = document.createElement("label");
    message.className = "chat-message mine";
    message.innerHTML = `<small>我 · 刚刚</small><input type="checkbox" checked>${safe(input.value.trim())}`;
    document.getElementById("splitThread").appendChild(message);
    input.value = "";
    syncSplitContext();
  });
  syncSplitContext();

  const splitResult = document.getElementById("splitResult");
  document.getElementById("splitResultClose").addEventListener("click",() => splitResult.classList.add("hidden"));
  const clampSplitResult = (left,top) => ({
    left:Math.max(12,Math.min(left,window.innerWidth - splitResult.offsetWidth - 12)),
    top:Math.max(12,Math.min(top,window.innerHeight - splitResult.offsetHeight - 12))
  });
  let splitResultDrag = null;
  splitResult.addEventListener("pointerdown",(event) => {
    if (event.button !== 0 || !event.target.closest(".light-result-head") || event.target.closest("button")) return;
    const rect = splitResult.getBoundingClientRect();
    splitResultDrag = {id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
    splitResult.setPointerCapture(event.pointerId);
    splitResult.classList.add("is-dragging");
    event.preventDefault();
  });
  splitResult.addEventListener("pointermove",(event) => {
    if (!splitResultDrag || event.pointerId !== splitResultDrag.id) return;
    const placed = clampSplitResult(splitResultDrag.left + event.clientX - splitResultDrag.x,splitResultDrag.top + event.clientY - splitResultDrag.y);
    splitResult.dataset.dragged = "true";
    splitResult.style.left = `${placed.left}px`;splitResult.style.top = `${placed.top}px`;splitResult.style.right = "auto";splitResult.style.bottom = "auto";
  });
  const finishSplitResultDrag = (event) => {
    if (!splitResultDrag || event.pointerId !== splitResultDrag.id) return;
    splitResultDrag = null;splitResult.classList.remove("is-dragging");
    if (splitResult.hasPointerCapture(event.pointerId)) splitResult.releasePointerCapture(event.pointerId);
  };
  splitResult.addEventListener("pointerup",finishSplitResultDrag);
  splitResult.addEventListener("pointercancel",finishSplitResultDrag);
  window.addEventListener("resize",() => {
    if (splitResult.classList.contains("hidden") || splitResult.dataset.dragged !== "true") return;
    const rect = splitResult.getBoundingClientRect();
    const placed = clampSplitResult(rect.left,rect.top);
    splitResult.style.left = `${placed.left}px`;splitResult.style.top = `${placed.top}px`;
  });

  const lightResults = {embed:null,split:null};
  const lightSelection = {embed:"polite",split:"polite"};
  const styleForContact = () => ({directness:Number(activeContact?.style?.directness || 3),politeness:Number(activeContact?.style?.politeness || 4),formality:Number(activeContact?.style?.formality || 4)});
  const renderLightResult = (kind,data) => {
    lightResults[kind] = data;
    const host = document.getElementById(`${kind}Result`);
    const available = ["direct","polite","concise"].filter((key) => data.candidates?.[key]);
    const defaultKey = styleForContact().directness >= 4 ? "direct" : "polite";
    lightSelection[kind] = available.includes(defaultKey) ? defaultKey : available[0];
    const refresh = () => {
      const key = lightSelection[kind];
      host.querySelector(".light-result-text").textContent = data.candidates[key];
      host.querySelector(".light-result-translation").textContent = preferences.features.translation ? `中文对照：${data.candidates[`${key}_translation`] || "暂不可用"}` : "";
      host.querySelectorAll(".light-choice").forEach((button) => button.classList.toggle("is-current",button.dataset.version === key));
    };
    host.querySelector(".light-result-choices").innerHTML = preferences.choiceAmount === "compare" ? available.map((key) => `<button type="button" class="light-choice" data-version="${key}">${{direct:"直接",polite:"礼貌",concise:"简洁"}[key]}</button>`).join("") : '<span class="host-status">按偏好推荐</span>';
    host.querySelectorAll(".light-choice").forEach((button) => button.addEventListener("click",() => { lightSelection[kind] = button.dataset.version; refresh(); }));
    host.classList.remove("hidden");
    refresh();
  };
  const generateLight = async (kind) => {
    const isEmbed = kind === "embed";
    const contextText = isEmbed
      ? document.getElementById("embedMailThread").innerText.trim()
      : document.getElementById("syncedContext").textContent.trim();
    const instruction = document.getElementById(isEmbed ? "embedInstruction" : "splitInstruction").value.trim();
    const status = document.getElementById(`${kind}Status`);
    if (!instruction) { status.textContent = "请先写下这次要表达的内容。"; return; }
    const button = document.getElementById(isEmbed ? "embedGenerate" : "splitGenerate");
    const relation = activeContact?.relation || "合作对象";
    const targetContext = isEmbed ? document.getElementById("embedContext").value : (activeContact?.context || "不确定 / 通用国际语境");
    const purpose = isEmbed ? document.getElementById("embedPurpose").value : "解释 / 进度说明";
    button.disabled = true;
    status.textContent = "正在结合联系人记忆和当前上下文生成…";
    try {
      const response = await fetch("/api/process",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        message:`沟通上下文：\n${contextText}\n\n本次表达目标：\n${instruction}`,
        constraint:"不得新增事实、日期、责任或承诺；保持当前对话中的人物指代一致。",
        sender_name:preferences.senderName || "",receiver_name:activeContact?.name || "",relation,purpose,target_context:targetContext,
        style_controls:styleForContact(),culture_overrides:contactCulture(activeContact),entry_mode:kind
      })});
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "生成失败");
      renderLightResult(kind,data);
      status.textContent = data.mode === "ai" ? "已生成，可选择版本并回填。" : "当前为 Demo 模式，不能将占位内容用于发送。";
    } catch (error) { status.textContent = `生成失败：${error.message}`; }
    finally { button.disabled = false; }
  };
  document.getElementById("embedGenerate").addEventListener("click",() => generateLight("embed"));
  document.getElementById("splitGenerate").addEventListener("click",() => generateLight("split"));
  document.querySelectorAll("[data-fill]").forEach((button) => button.addEventListener("click",() => {
    const kind = button.dataset.fill;
    const result = lightResults[kind];
    if (!result || result.mode !== "ai") return document.getElementById(`${kind}Status`).textContent = "只有 AI 成功生成的内容可以回填。";
    document.getElementById(kind === "embed" ? "embedReply" : "splitReply").value = result.candidates[lightSelection[kind]] || "";
    document.getElementById(`${kind}Status`).textContent = "已回填原输入框，请核对后发送。";
  }));
  document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click",async() => {
    const kind = button.dataset.copy,result = lightResults[kind];
    if (!result || result.mode !== "ai") return;
    await navigator.clipboard.writeText(result.candidates[lightSelection[kind]] || "");
    document.getElementById(`${kind}Status`).textContent = "表达已复制。";
  }));
  let initialMode = "web";
  try { initialMode = localStorage.getItem(modeKey) || "web"; } catch (_) { /* Use web mode. */ }
  setProductMode(initialMode);
  const backToHome = document.getElementById("pageBack");
  backToHome.remove();
  const compact = () => window.matchMedia("(max-width:760px)").matches;
  const selectMobileView = (page,section) => {
    const host = page === "setup" ? home : compose;
    if (page === "compose" && confirmPanel.classList.contains("hidden")) section = "message";
    host.dataset.mobileView = section;
    host.querySelectorAll(".mobile-section-tab").forEach((button) => {
      button.disabled = page === "compose" && button.dataset.mobileSection !== "message" && confirmPanel.classList.contains("hidden");
      button.setAttribute("aria-selected",String(button.dataset.mobileSection === section));
      button.tabIndex = button.dataset.mobileSection === section ? 0 : -1;
    });
    content.scrollTop = 0;
  };
  selectMobileView("setup","preferences");
  selectMobileView("compose","message");
  document.querySelectorAll(".mobile-section-tab").forEach((button) => button.onclick = () => {
    const page = button.closest("[data-stage]").dataset.stage;
    navigateStage(page,button.dataset.mobileSection);
  });
  let versionConfirmed = false;
  const stageAvailable = (id) => {
    return id === "setup" || id === "compose" ||
      (id === "results" && !versionSec.classList.contains("hidden")) ||
      (["refine","draft"].includes(id) && versionConfirmed);
  };
  let currentStage = "setup";
  navigateStage = (id,view) => {
    if (!stageAvailable(id)) return;
    if (id === "draft" && preferences.requireReview && !document.getElementById("meaningAccepted").checked) {
      document.getElementById("meaningStatus").textContent = "请先核对并确认，再准备草稿。";
      navigateStage("refine");
      meaningStage.scrollIntoView({behavior:"smooth",block:"center"});
      return;
    }
    currentStage = id;
    stages.forEach(([key,,panel],index) => {
      panel.classList.toggle("hidden",key !== id);
      panel.classList.toggle("is-current",key === id);
      const step = stageNav.querySelector(`[data-jump="${key}"]`);
      step.disabled = !stageAvailable(key);
      step.classList.toggle("is-current",key === id);
      step.classList.toggle("is-done",index < stages.findIndex(([candidate]) => candidate === id));
      if (key === id) step.setAttribute("aria-current","step"); else step.removeAttribute("aria-current");
    });
    meaningStage.classList.toggle("hidden",!preferences.requireReview);
    refreshReviewActions();
    if (id === "setup" || id === "compose") selectMobileView(id,view || (id === "setup" ? home.dataset.mobileView : compose.dataset.mobileView));
    stylePanel.classList.toggle("hidden",confirmPanel.classList.contains("hidden"));
    content.scrollTop = 0;
    window.scrollTo(0,0);
    if (id === "refine") requestAnimationFrame(resizeFinalBody);
  };
  refreshStages = () => navigateStage(stageAvailable(currentStage) ? currentStage : "setup");
  stageNav.querySelectorAll("[data-jump]").forEach((button) => button.onclick = () => navigateStage(button.dataset.jump,
    button.dataset.jump === "setup" ? "preferences" : button.dataset.jump === "compose" ? "message" : undefined));
  preferencesContinue.onclick = () => navigateStage("setup","contacts");
  setupContinue.onclick = () => navigateStage("compose","message");
  confirmContinue.onclick = () => navigateStage("compose","style");
  quickPrepareDraft.onclick = prepareDraft.onclick = () => navigateStage("draft");
  refreshReviewActions = () => {
    prepareDraft.classList.toggle("hidden",!preferences.requireReview || !document.getElementById("meaningAccepted").checked);
    quickPrepareDraft.classList.toggle("hidden",preferences.requireReview);
  };
  refreshReviewActions();
  confirmVersion.addEventListener("click",() => {
    const selected = versions.querySelector(".version.active");
    if (!selected) return;
    if (!versions.classList.contains("choice-locked")) {
      versions.classList.add("choice-locked");
      toolbar.classList.remove("hidden");
      decorateSelectedVersion();
      syncFinalBody();
      applyFeaturePreferences();
    }
    versionConfirmed = true;
    navigateStage("refine");
  });
  changeVersion.addEventListener("click",() => {
    closeWordEditor();
    versionConfirmed = false;
    document.getElementById("meaningAccepted").checked = false;
    document.getElementById("meaningStatus").textContent = "";
    refreshReviewActions();
    versions.classList.remove("choice-locked");
    toolbar.classList.add("hidden");
    navigateStage("results");
  });
  document.addEventListener("generation-start",(event) => {
    if (event.detail?.entryMode === "web") versionConfirmed = false;
  });
  document.getElementById("meaningAccepted").addEventListener("change",() => {
    document.getElementById("meaningStatus").textContent = "";
    refreshReviewActions();
  });
  const extractionObserver = new MutationObserver(() => {
    if (!confirmPanel.classList.contains("hidden") && currentStage === "compose") {
      stylePanel.classList.remove("hidden");
      navigateStage("compose",compact() ? "confirm" : undefined);
    }
  });
  extractionObserver.observe(confirmPanel,{attributes:true,attributeFilter:["class"]});
  document.addEventListener("draft-saved",() => writeAnother.classList.add("is-visible"));
  writeAnother.addEventListener("click",() => {
    document.dispatchEvent(new Event("new-communication"));
    versionConfirmed = false;
    restoreActiveContact();
    lastAppliedCulture = null;
    writeAnother.classList.remove("is-visible");
    navigateStage("compose","message");
  });
  navigateStage("setup");
  let translationTimer = null;
  let translationRequest = 0;

  function applyFeaturePreferences() {
    const features = preferences.features || {};
    document.body.classList.toggle("single-version",preferences.choiceAmount === "single");
    document.body.classList.toggle("detailed-editing",preferences.editingDepth === "detailed");
    document.querySelectorAll(".version-translation,#generatedTranslation").forEach((node) => node.classList.toggle("feature-hidden",!features.translation));
    editingTools.classList.toggle("feature-hidden",!features.sentence);
    wordHint.classList.toggle("feature-hidden",!features.word);
    versionChoice.classList.toggle("hidden",preferences.choiceAmount !== "single");
    document.querySelector('[data-inline-action="explain"]')?.classList.toggle("feature-hidden",!features.explanation);
    sentenceToolbar.querySelectorAll('[data-action="rewrite"],[data-action="tone"],[data-action="shorten"]').forEach((button) => button.classList.toggle("feature-hidden",!features.sentence));
    sentenceToolbar.querySelector('[data-action="explain"]')?.classList.toggle("feature-hidden",!features.explanation);
    if (!features.word) versions.querySelectorAll(".version p[data-word-ready='true']").forEach((paragraph) => {
      paragraph.textContent = paragraph.textContent;
      paragraph.dataset.wordReady = "false";
    });
    else decorateSelectedVersion();
    document.querySelectorAll(".word-custom,.word-advanced").forEach((node) => node.classList.toggle("feature-hidden",!features.sentence));
    if (!features.word) closeWordEditor();
    if (!features.sentence && !features.explanation) closeSentenceTools();
  }

  function refreshSelectedTranslation() {
    if (!preferences.features.translation || !finalBody.value.trim()) return;
    const requestId = ++translationRequest;
    clearTimeout(translationTimer);
    const output = document.getElementById("selectedTranslation");
    if (window.__generatedCommunication?.mode === "demo") {
      if (output) output.textContent = "Demo 示例不提供可靠译文。";
      return;
    }
    if (output) output.textContent = "表达已调整，正在更新中文对照…";
    translationTimer = setTimeout(async () => {
      try {
        const response = await fetch("/api/revise-sentence", {
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({sentence:finalBody.value,request:"Translate to Simplified Chinese, preserving meaning, tone, facts, and commitments.",operation:"translate"})
        });
        const data = await response.json();
        if (!data.ok) throw new Error(data.error || "翻译失败");
        if (requestId === translationRequest && output) output.textContent = data.revised_sentence;
        const selected = versions.querySelector(".version.active .version-translation");
        if (selected && requestId === translationRequest) selected.querySelector(".translation-text").textContent = data.revised_sentence;
      } catch (_) {
        if (requestId === translationRequest && output) output.textContent = "译文暂不可用，可继续编辑原文。";
      }
    },500);
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (resource,options) => {
    const url = typeof resource === "string" ? resource : resource.url;
    const generation = url.includes("/api/process") && options?.body ? JSON.parse(options.body) : null;
    const detail = generation ? {
      relation:generation.relation,context:generation.target_context,purpose:generation.purpose,
      style:generation.style_controls,culture:generation.culture_overrides,
      message:generation.message,entryMode:generation.entry_mode || "web",contactId:null,contactTerms:[],contactHistory:[],saveStyle:false,saveCulture:false,isRevision:!!generation.is_revision
    } : null;
    if (detail) document.dispatchEvent(new CustomEvent("generation-start",{detail}));
    if (generation) {
      generation.contact_memory = {
        terms:detail.contactTerms,
        recent_history:detail.contactHistory
      };
      options = {...options,body:JSON.stringify(generation)};
    }
    const response = await nativeFetch(resource,options);
    if (url.includes("/api/extract")) {
      try {
        const extraction = await response.clone().json();
        if (extraction.mode === "demo") {
          document.getElementById("status").textContent = extraction.warning || "Demo 提取仅供填写参考，请逐项核对。";
        }
      } catch (_) { /* The original response remains available to the caller. */ }
    }
    if (generation) {
      try {
        window.__generatedCommunication = await response.clone().json();
        if (window.__generatedCommunication?.ok && window.__generatedCommunication.mode === "ai") {
          document.dispatchEvent(new CustomEvent("generation-complete",{detail}));
        }
      }
      catch (_) { window.__generatedCommunication = null; }
    }
    return response;
  };

  const toolbar = document.createElement("div");
  toolbar.className = "version-toolbar hidden";
  toolbar.innerHTML = '<button type="button" class="button secondary" id="rechooseVersion">重新选择版本</button>';
  versions.insertAdjacentElement("afterend", toolbar);

  const segmentWords = (text) => {
    const language = /[\u3040-\u30ff]/.test(text) ? "ja" : /[\uac00-\ud7af]/.test(text) ? "ko" : /[\u4e00-\u9fff]/.test(text) ? "zh" : "en";
    try {
      return [...new Intl.Segmenter(language, {granularity: "word"}).segment(text)].map((item) => ({text:item.segment, word:!!item.isWordLike}));
    } catch (_) {
      return String(text).split(/(\s+|[,.!?;:，。！？；：])/).filter(Boolean).map((part) => ({text:part, word:/[\p{L}\p{N}]/u.test(part)}));
    }
  };

  const sentenceRanges = (text) => {
    const ranges = [];
    const matcher = /[^.!?。！？\n]+(?:[.!?。！？]+|$)/g;
    for (const match of text.matchAll(matcher)) {
      const raw = match[0];
      const left = raw.length - raw.trimStart().length;
      const right = raw.trimEnd().length;
      if (right > left) ranges.push({start:match.index + left,end:match.index + right,text:raw.slice(left,right)});
    }
    return ranges;
  };
  const populateSentenceSelectors = () => {
    const sentences = sentenceRanges(finalBody.value);
    const select = document.getElementById("sentenceSelect");
    const previous = select.value;
    select.innerHTML = sentences.map((item,index) => `<option value="${index}">${index + 1}. ${escHtml(item.text.slice(0,100))}</option>`).join("");
    select.value = previous && +previous < sentences.length ? previous : "0";
    const chosen = sentences[Number(document.getElementById("sentenceSelect").value)];
    document.getElementById("sentencePreview").textContent = chosen?.text || "暂无可编辑的句子";
  };
  document.getElementById("sentenceSelect").addEventListener("change",() => {
    const range = sentenceRanges(finalBody.value)[Number(document.getElementById("sentenceSelect").value)];
    document.getElementById("sentencePreview").textContent = range?.text || "暂无可编辑的句子";
  });
  const inlineResult = document.getElementById("inlineEditResult");
  const showInlineResult = (snapshot,data) => {
    inlineResult.replaceChildren();
    if (data.explanation) {
      inlineResult.textContent = data.explanation;
      return;
    }
    const alternatives = (data.alternatives || []).filter((item) => item && item !== snapshot.selection);
    if (!alternatives.length) {
      inlineResult.textContent = data.mode === "demo" ? "Demo 模式无法为这一句可靠地生成修改，请连接 AI 后重试。" : "没有适合的改写建议；原句保持不变。";
      return;
    }
    const heading = document.createElement("p");
    heading.className = "edit-note";
    heading.textContent = data.mode === "demo" ? "Demo 示例，应用后仍需人工核对语法。" : "结合前后文生成，点击应用才会替换所选句。";
    inlineResult.appendChild(heading);
    alternatives.forEach((candidate) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sentence-result";
      const label = document.createElement("strong");
      label.textContent = "应用这句修改";
      button.append(label,document.createTextNode(candidate));
      button.addEventListener("click",() => {
        if (finalBody.value !== snapshot.text) {
          inlineResult.textContent = "正文已变化，请重新生成建议。";
          return;
        }
        finalBody.value = snapshot.text.slice(0,snapshot.start) + candidate + snapshot.text.slice(snapshot.end);
        finalBody.dispatchEvent(new Event("input",{bubbles:true}));
        inlineResult.textContent = "已更新所选句子，前后文保持不变。";
        editStatus.textContent = "局部修改已应用，请核对全文和译文。";
      });
      inlineResult.appendChild(button);
    });
  };
  const requestInlineEdit = async (snapshot,operation,extra={}) => {
    inlineResult.textContent = "正在结合前后文检查语法和表达…";
    try {
      const response = await fetch("/api/edit-selection",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({before:snapshot.text.slice(0,snapshot.start),selection:snapshot.selection,
          after:snapshot.text.slice(snapshot.end),operation,target_context:context?.value || "",
          constraint:document.getElementById("constraint").value,...extra})
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "生成失败");
      showInlineResult(snapshot,data);
    } catch (error) { inlineResult.textContent = `暂无法生成：${error.message}`; }
  };
  editingTools.querySelectorAll("[data-inline-action]").forEach((button) => button.addEventListener("click",() => {
    const operation = button.dataset.inlineAction;
    if (operation === "tone" && document.getElementById("inlineTone").classList.contains("hidden")) {
      document.getElementById("inlineTone").classList.remove("hidden");
      return;
    }
    const range = sentenceRanges(finalBody.value)[Number(document.getElementById("sentenceSelect").value)];
    if (!range) return;
    requestInlineEdit({...range,selection:range.text,text:finalBody.value},operation,
      operation === "tone" ? {tone:document.getElementById("inlineTone").value} : {});
  }));

  const selectedParagraph = () => versions.querySelector(".version.active p");
  const decorateEditPreview = () => {
    const preview = document.getElementById("editPreview");
    if (!preview) return;
    preview.innerHTML = preferences.features.word
      ? segmentWords(finalBody.value).map((segment) => segment.word
        ? `<button type="button" class="word-token" title="点击逐词修改">${escHtml(segment.text)}</button>`
        : escHtml(segment.text)).join("")
      : escHtml(finalBody.value);
  };

  const sentenceForToken = (token) => {
    const paragraph = token.closest("p");
    const text = paragraph?.textContent || "";
    const before = document.createRange();
    before.selectNodeContents(paragraph);
    before.setEndBefore(token);
    const offset = before.toString().length;
    const punctuation = /[.!?。！？]/;
    let start = 0;
    for (let index = offset - 1; index >= 0; index -= 1) {
      if (punctuation.test(text[index])) { start = index + 1; break; }
    }
    let end = text.length;
    for (let index = offset; index < text.length; index += 1) {
      if (punctuation.test(text[index])) { end = index + 1; break; }
    }
    while (/\s/.test(text[start] || "")) start += 1;
    return {paragraph,text,start,end,sentence:text.slice(start,end).trim(),word:token.textContent.trim()};
  };

  const applyEditedSentence = (paragraph, previousText, start, end, revised) => {
    paragraph.textContent = previousText.slice(0,start) + revised + previousText.slice(end);
    paragraph.dataset.wordReady = "false";
    decorateSelectedVersion();
    syncFinalBody();
    refreshSelectedTranslation();
  };

  const contextualWordEdit = async (token, replacement, request = "") => {
    const info = sentenceForToken(token);
    const status = document.querySelector(".word-editor-status");
    const sentence = info.text.slice(info.start,info.end);
    const source = finalBody.value;
    if (source !== info.text) throw new Error("正文已变化，请重新选词");
    if (status) status.textContent = `正在结合整句语法与搭配调整“${replacement}”…`;
    const response = await fetch("/api/edit-selection", {
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        before:source.slice(0,info.start),selection:sentence,after:source.slice(info.end),
        word_original:info.word,word_replacement:replacement,word_request:request,operation:"word",
        constraint:document.getElementById("constraint").value,target_context:context?.value || ""
      })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "上下文修改失败");
    if (finalBody.value !== source) throw new Error("正文已变化，请重新选词");
    const revised = data.alternatives?.find((item) => item !== sentence);
    if (!revised) throw new Error("没有适合的改写建议，原句保持不变");
    finalBody.value = source.slice(0,info.start) + revised + source.slice(info.end);
    finalBody.dispatchEvent(new Event("input",{bubbles:true}));
    if (editStatus) editStatus.textContent = data.mode === "demo" ? "Demo 示例：已调整选句，请人工核对语法。" : "已结合上下文和语法调整整句。";
    closeWordEditor();
  };

  const decorateSelectedVersion = () => {
    const paragraph = selectedParagraph();
    if (!paragraph || paragraph.dataset.wordReady === "true" || !preferences.features.word) return;
    const text = paragraph.textContent;
    paragraph.innerHTML = preferences.features.word ? segmentWords(text).map((segment, index) => segment.word
      ? `<button type="button" class="word-token" data-word-index="${index}" title="点击词语查看替换建议">${escHtml(segment.text)}</button>`
      : escHtml(segment.text)
    ).join("") : escHtml(text);
    paragraph.dataset.wordReady = "true";
  };

  const syncFinalBody = () => {
    const paragraph = selectedParagraph();
    if (!paragraph) return;
    finalBody.value = paragraph.textContent.replace(/\s+([,.!?;:])/g, "$1");
    finalBody.dispatchEvent(new Event("input",{bubbles:true}));
  };

  const closeWordEditor = () => {
    document.querySelectorAll(".word-editor").forEach((node) => node.remove());
    document.querySelectorAll(".word-token.is-open").forEach((node) => node.classList.remove("is-open"));
  };

  const placeEditor = (editor, anchor) => {
    const clamp = (value,max) => Math.max(12,Math.min(value,Math.max(12,max)));
    if (editor.dataset.dragged === "true") {
      const rect = editor.getBoundingClientRect();
      editor.style.left = `${clamp(rect.left,window.innerWidth - rect.width - 12)}px`;
      editor.style.top = `${clamp(rect.top,window.innerHeight - rect.height - 12)}px`;
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(560, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left - 20, window.innerWidth - width - 12));
    editor.style.left = `${left}px`;
    editor.style.top = "12px";
    requestAnimationFrame(() => {
      const height = editor.offsetHeight;
      const below = rect.bottom + 10;
      const above = rect.top - height - 10;
      const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, above);
      editor.style.top = `${top}px`;
    });
  };
  window.addEventListener("resize",() => {
    const editor = document.querySelector(".word-editor");
    if (!editor) return;
    const rect = editor.getBoundingClientRect();
    editor.style.left = `${Math.max(12,Math.min(rect.left,Math.max(12,window.innerWidth - editor.offsetWidth - 12)))}px`;
    editor.style.top = `${Math.max(12,Math.min(rect.top,Math.max(12,window.innerHeight - editor.offsetHeight - 12)))}px`;
  });

  const makeEditorDraggable = (editor) => {
    let drag = null;
    editor.addEventListener("pointerdown",(event) => {
      if (event.button !== 0 || !event.target.closest(".word-editor-topbar") || event.target.closest(".word-editor-window-actions")) return;
      const rect = editor.getBoundingClientRect();
      drag = {pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
      editor.setPointerCapture(event.pointerId);
      editor.classList.add("is-dragging");
      event.preventDefault();
    });
    editor.addEventListener("pointermove",(event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const left = drag.left + event.clientX - drag.x;
      const top = drag.top + event.clientY - drag.y;
      editor.dataset.dragged = "true";
      editor.style.left = `${Math.max(12,Math.min(left,Math.max(12,window.innerWidth - editor.offsetWidth - 12)))}px`;
      editor.style.top = `${Math.max(12,Math.min(top,Math.max(12,window.innerHeight - editor.offsetHeight - 12)))}px`;
    });
    const finish = (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag = null;
      editor.classList.remove("is-dragging");
      if (editor.hasPointerCapture(event.pointerId)) editor.releasePointerCapture(event.pointerId);
    };
    editor.addEventListener("pointerup",finish);
    editor.addEventListener("pointercancel",finish);
  };

  const bindWordEditorWindowActions = (editor) => {
    const collapse = editor.querySelector(".word-editor-collapse");
    const close = editor.querySelector(".word-editor-close");
    if (close) close.onclick = closeWordEditor;
    if (!collapse) return;
    collapse.onclick = () => {
      const collapsed = editor.classList.toggle("is-collapsed");
      collapse.setAttribute("aria-expanded",String(!collapsed));
      collapse.setAttribute("aria-label",collapsed ? "展开逐词修改窗口" : "收起逐词修改窗口");
      collapse.title = collapsed ? "展开" : "收起";
      const rect = editor.getBoundingClientRect();
      editor.style.left = `${Math.max(12,Math.min(rect.left,window.innerWidth - editor.offsetWidth - 12))}px`;
      editor.style.top = `${Math.max(12,Math.min(rect.top,window.innerHeight - editor.offsetHeight - 12))}px`;
    };
  };

  const requestWordOptions = async (info) => {
    const response = await fetch("/api/word-options", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({word:info.word,sentence:info.sentence,
        before:info.text.slice(0,info.start),after:info.text.slice(info.end),
        target_context:context?.value || "",constraint:document.getElementById("constraint").value})
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "整句候选获取失败");
    return data;
  };

  const renderSuggestion = (editor, token, info, source, suggestion) => {
    const options = suggestion.mode === "ai" && Array.isArray(suggestion.options) ? suggestion.options : [];
    let selectedIndex = options.length ? 0 : -1;
    editor.innerHTML = `
      <div class="word-editor-topbar">
        <div class="word-editor-brand"><span class="word-editor-spark">✦</span><strong>${options.length ? "AI 整句候选" : "暂无候选"}</strong><span>选择词语，核对完整句子</span></div>
        <div class="word-editor-window-actions"><button type="button" class="word-editor-collapse" aria-label="收起逐词修改窗口" aria-expanded="true" title="收起">−</button><button type="button" class="word-editor-close" aria-label="关闭">×</button></div>
      </div>
      ${options.length ? `<div class="word-alternatives"><div class="word-alternatives-head"><span>替换版本</span><span>${options.length} 个</span></div>
        <div class="word-alternative-list">${options.map((item,index) => `<button type="button" class="word-alt" data-option="${index}" aria-pressed="${index === 0}"><b>${escHtml(item.word)}</b><small>（${escHtml(item.label)}）</small></button>`).join("")}</div></div>` : ""}
      <div class="word-suggestion">
        ${options.length ? `<span class="word-sentence-label">原句</span><p class="word-original-sentence">${escHtml(info.sentence)}</p>
          <span class="word-sentence-label">修改后整句</span><p class="word-revised-sentence"></p><p class="word-grammar-note"></p>`
          : `<p class="word-original-sentence">${escHtml(suggestion.warning || "没有可靠的上下文替换建议，原句保持不变。")}</p>`}
      </div>
      <div class="word-suggestion-actions">
        <button type="button" class="word-action dismiss-suggestion">忽略</button>
        ${options.length ? '<button type="button" class="word-action primary apply-suggestion">应用整句修改</button>' : ""}
      </div>
      <div class="word-editor-status" aria-live="polite"></div>
      ${suggestion.mode !== "ai" ? "" : `<details class="word-custom word-advanced">
        <summary>更多调整</summary>
        <div class="word-adjustments">
          <button type="button" data-word-adjustment="Improve the grammar of the sentence containing the selected word without changing its meaning.">整句语法</button>
          <button type="button" data-word-adjustment="Adjust the tone of the sentence containing the selected word to sound appropriate in context.">语气与上下文</button>
          <button type="button" data-word-adjustment="Rewrite the sentence containing the selected word more naturally while preserving its meaning.">更自然表达</button>
        </div>
        <div class="word-editor-status"></div>
      </details>
      <details class="word-custom">
        <summary>自定义替换要求</summary>
        <div class="word-custom-row">
          <input class="custom-word-request" placeholder="例如：更正式 / 更简单 / 更自然">
          <button type="button" class="button secondary custom-word-button">AI 修改</button>
        </div>
        <div class="word-editor-status"></div>
      </details>`}`;

    bindWordEditorWindowActions(editor);
    editor.querySelector(".dismiss-suggestion").onclick = closeWordEditor;
    const showOption = (index) => {
      selectedIndex = index;
      const selected = options[index];
      editor.querySelector(".word-revised-sentence").textContent = selected.sentence;
      editor.querySelector(".word-grammar-note").textContent = selected.explanation;
      editor.querySelectorAll(".word-alt").forEach((button) => button.setAttribute("aria-pressed",String(Number(button.dataset.option) === index)));
    };
    if (options.length) {
      showOption(0);
      editor.querySelectorAll(".word-alt").forEach((button) => {
        button.onclick = () => showOption(Number(button.dataset.option));
      });
      editor.querySelector(".apply-suggestion").onclick = () => {
        const status = editor.querySelector(":scope > .word-editor-status");
        if (!editor.isConnected || finalBody.value !== source || !token.isConnected) {
          status.textContent = "正文已变化，请重新选词生成候选。";
          return;
        }
        const selected = options[selectedIndex];
        finalBody.value = source.slice(0,info.start) + selected.sentence + source.slice(info.end);
        finalBody.dispatchEvent(new Event("input",{bubbles:true}));
        editStatus.textContent = `已应用“${selected.label}”整句修改，请核对全文和译文。`;
        closeWordEditor();
      };
    }

    const customButton = editor.querySelector(".custom-word-button");
    if (customButton) customButton.onclick = async () => {
      const request = editor.querySelector(".custom-word-request").value.trim();
      const status = editor.querySelector(".word-custom .word-editor-status");
      if (!request) { status.textContent = "请先写修改要求。"; return; }
      customButton.disabled = true;
      status.textContent = "AI 正在结合整句搭配修改…";
      try {
        await contextualWordEdit(token,"",request);
      } catch (error) {
        status.textContent = `修改失败：${error.message}`;
      } finally {
        customButton.disabled = false;
      }
    };

    editor.querySelectorAll("[data-word-adjustment]").forEach((button) => button.addEventListener("click", async () => {
      const status = editor.querySelector(".word-advanced .word-editor-status");
      button.disabled = true;
      status.textContent = "正在调整选中词所在句子…";
      try {
        await contextualWordEdit(token,"",button.dataset.wordAdjustment);
      } catch (error) {
        status.textContent = `修改失败：${error.message}`;
      } finally {
        button.disabled = false;
      }
    }));
  };

  const openWordEditor = async (token) => {
    closeWordEditor();
    token.classList.add("is-open");
    const info = sentenceForToken(token);
    const source = finalBody.value;

    const editor = document.createElement("div");
    editor.className = "word-editor";
    editor.innerHTML = `
      <div class="word-editor-topbar">
        <div class="word-editor-brand"><span class="word-editor-spark">✦</span><strong>整句候选</strong><span>正在检查上下文与搭配…</span></div>
        <div class="word-editor-window-actions"><button type="button" class="word-editor-collapse" aria-label="收起逐词修改窗口" aria-expanded="true" title="收起">−</button><button type="button" class="word-editor-close" aria-label="关闭">×</button></div>
      </div>
      <div class="word-editor-loading">正在生成完整句子和语法搭配说明…</div>`;
    document.body.appendChild(editor);
    bindWordEditorWindowActions(editor);
    makeEditorDraggable(editor);
    placeEditor(editor, token);

    try {
      const suggestion = await requestWordOptions(info);
      if (!editor.isConnected) return;
      renderSuggestion(editor, token, info, source, suggestion);
      placeEditor(editor, token);
    } catch (error) {
      if (editor.isConnected) editor.querySelector(".word-editor-loading").textContent = `获取建议失败：${error.message}`;
    }
  };

  versions.addEventListener("click", (event) => {
    if (window.getSelection()?.toString().trim()) {
      event.stopPropagation();
      return;
    }
    const token = event.target.closest(".word-token");
    if (token) {
      event.preventDefault();
      event.stopPropagation();
      openWordEditor(token);
      return;
    }

    const card = event.target.closest(".version");
    if (!card) return;
    if (versions.classList.contains("choice-locked") && card.classList.contains("active")) {
      event.stopPropagation();
      return;
    }
    requestAnimationFrame(() => {
      versions.classList.add("choice-locked");
      toolbar.classList.remove("hidden");
      versions.querySelectorAll(".version p").forEach((p) => {
        if (!p.closest(".version").classList.contains("active")) p.dataset.wordReady = "false";
      });
      decorateSelectedVersion();
      syncFinalBody();
      applyFeaturePreferences();
      if (editStatus) editStatus.textContent = "已锁定当前版本。点击正文中的任意词语，可查看上下文替换建议。";
    });
  }, true);
  document.getElementById("editPreview").addEventListener("click",(event) => {
    const token = event.target.closest(".word-token");
    if (token) openWordEditor(token);
  });

  toolbar.querySelector("#rechooseVersion").addEventListener("click", () => {
    closeWordEditor();
    versions.classList.remove("choice-locked");
    toolbar.classList.add("hidden");
    closeSentenceTools();
    versions.querySelectorAll(".version p").forEach((p) => {
      if (p.dataset.wordReady === "true") {
        p.textContent = p.textContent;
        p.dataset.wordReady = "false";
      }
    });
    versions.scrollIntoView({behavior:"smooth", block:"nearest"});
  });

  const observer = new MutationObserver(() => {
    if (versions.children.length >= 3) {
      const generated = window.__generatedCommunication;
      if (generated?.candidates) {
        const relationship = generated.context?.relationship;
        const speech = generated.context?.speech_act;
        const basis = [relationship?.evidence,speech?.evidence].filter(Boolean).join("；");
        cultureNarrative.textContent = `目标：${generated.culture?.target_context || context.value} · 关系：${document.getElementById("relation").value === "custom" ? document.getElementById("custom_relation").value : document.getElementById("relation").value} · 目的：${document.getElementById("purpose").value === "custom" ? document.getElementById("custom_purpose").value : document.getElementById("purpose").value}。${generated.culture?.scenario_note || generated.culture?.boundary_rule || generated.culture?.rule || "关系与本次沟通目的优先于地域倾向。"}${basis ? ` 依据：${basis}` : ""}`;
        document.getElementById("meaningFacts").textContent = `事实：${generated.intent?.fact || document.getElementById("message").value}\n目标：${generated.intent?.goal || document.getElementById("purpose").value}\n立场：${generated.intent?.stance || "以原文为准"}\n边界：${document.getElementById("constraint").value || "请确认没有新增道歉、责任或承诺"}`;
        document.getElementById("meaningAccepted").checked = false;
        versions.querySelectorAll(".version").forEach((card) => {
          if (card.querySelector(".version-translation")) return;
          const key = card.dataset.k;
          const translation = generated.candidates[`${key}_translation`] || "Demo 模式暂不提供译文";
          const translated = document.createElement("p");
          translated.className = "version-translation";
          translated.innerHTML = `<span class="translation-label">中文译文</span><span class="translation-text"></span>`;
          translated.querySelector(".translation-text").textContent = translation;
          card.appendChild(translated);
        });
        const selectedKey = versions.querySelector(".version.active")?.dataset.k || "polite";
        const passed = document.querySelector("#checkBox .pass b");
        if (passed) passed.textContent = "生成时自检未发现风险";
        const selectedTranslation = document.getElementById("selectedTranslation");
        if (selectedTranslation) selectedTranslation.textContent = generated.candidates[`${selectedKey}_translation`] || "Demo 模式暂不提供译文";
        apiWarning.classList.toggle("hidden",generated.mode === "ai");
        apiWarning.textContent = generated.mode === "ai" ? "" : `Demo 模式：AI 请求未完成。${generated.warning || "当前仅展示固定流程示例，译文与语法需人工核对。"}`;
        for (const id of ["copyMail","saveDraft"]) {
          const button = document.getElementById(id);
          button.disabled = generated.mode !== "ai";
          button.title = generated.mode === "ai" ? "" : "Demo 占位内容不可用作邮件，请重新生成。";
        }
        showPage("work");
      }
      closeWordEditor();
      versions.classList.remove("choice-locked");
      toolbar.classList.add("hidden");
      document.body.classList.remove("show-all-versions");
      applyFeaturePreferences();
      populateSentenceSelectors();
      decorateEditPreview();
      requestAnimationFrame(resizeFinalBody);
    }
  });
  observer.observe(versions, {childList:true});

  let selectionState = null;
  const sentenceToolbar = document.createElement("div");
  sentenceToolbar.className = "sentence-toolbar hidden";
  sentenceToolbar.innerHTML = '<button type="button" data-action="rewrite">重写</button><button type="button" data-action="tone">语气</button><button type="button" data-action="shorten">精简</button><button type="button" data-action="explain">解释</button>';
  document.body.appendChild(sentenceToolbar);

  const closeSentenceTools = () => {
    sentenceToolbar.classList.add("hidden");
    document.querySelectorAll(".sentence-tone-options,.sentence-results").forEach((node) => node.remove());
  };
  const positionFloating = (node, rect) => {
    node.style.left = `${Math.max(12,Math.min(rect.left,window.innerWidth - node.offsetWidth - 12))}px`;
    node.style.top = `${Math.max(12,Math.min(rect.top - node.offsetHeight - 9,window.innerHeight - node.offsetHeight - 12))}px`;
  };
  const captureSelection = () => {
    if (document.activeElement === finalBody) {
      const start = finalBody.selectionStart, end = finalBody.selectionEnd;
      const text = finalBody.value;
      if (start === end || end - start > 1500) return null;
      return {source:"textarea",start,end,text,selection:text.slice(start,end),rect:finalBody.getBoundingClientRect()};
    }
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    const paragraph = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer.closest(".version.active p")
      : range.commonAncestorContainer.parentElement?.closest(".version.active p");
    if (!paragraph || !versions.contains(paragraph)) return null;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(paragraph);
    prefix.setEnd(range.startContainer,range.startOffset);
    const start = prefix.toString().length;
    const text = paragraph.textContent;
    const end = start + range.toString().length;
    if (start === end || end - start > 1500) return null;
    return {source:"paragraph",paragraph,start,end,text,selection:text.slice(start,end),rect:range.getBoundingClientRect()};
  };
  const detectSentenceSelection = () => {
    if (document.querySelector(".sentence-results,.sentence-tone-options")) return;
    const captured = captureSelection();
    if (!captured || !captured.selection.trim()) { closeSentenceTools(); return; }
    selectionState = captured;
    closeSentenceTools();
    sentenceToolbar.classList.remove("hidden");
    applyFeaturePreferences();
    if (!sentenceToolbar.querySelector("button:not(.feature-hidden)")) { closeSentenceTools(); return; }
    positionFloating(sentenceToolbar, captured.rect);
  };
  versions.addEventListener("pointerup", () => requestAnimationFrame(detectSentenceSelection));
  versions.addEventListener("keyup", detectSentenceSelection);
  finalBody.addEventListener("select", detectSentenceSelection);
  finalBody.addEventListener("keyup", detectSentenceSelection);
  finalBody.addEventListener("input", () => {
    selectionState = null;
    closeSentenceTools();
    document.getElementById("meaningAccepted").checked = false;
    document.getElementById("meaningStatus").textContent = "正文已修改，请重新核对事实、立场和承诺。";
    refreshReviewActions();
    const paragraph = selectedParagraph();
    if (paragraph && paragraph.textContent !== finalBody.value) {
      paragraph.textContent = finalBody.value;
      paragraph.dataset.wordReady = "false";
      decorateSelectedVersion();
    }
    populateSentenceSelectors();
    decorateEditPreview();
    refreshSelectedTranslation();
  });

  const showSentenceResults = (title, data, snapshot) => {
    document.querySelectorAll(".sentence-tone-options,.sentence-results").forEach((node) => node.remove());
    const results = document.createElement("div");
    results.className = "sentence-results";
    const items = data.alternatives || [];
    results.innerHTML = `<h3>${escHtml(title)}${data.mode === "demo" ? " · Demo 示例" : ""}</h3>${data.explanation
      ? `<div class="sentence-status">${escHtml(data.explanation)}</div>`
      : items.map((item,index) => `<button type="button" class="sentence-result" data-result="${index}"><span>表达版本 ${String.fromCharCode(65 + index)} · 点击应用</span>${escHtml(item)}</button>`).join("")}`;
    document.body.appendChild(results);
    positionFloating(results, snapshot.rect);
    results.querySelectorAll(".sentence-result").forEach((button,index) => {
      button.addEventListener("click", () => {
        const current = snapshot.source === "textarea" ? finalBody.value : snapshot.paragraph.textContent;
        if (current !== snapshot.text || (snapshot.source === "paragraph" && (!snapshot.paragraph.isConnected || finalBody.value !== snapshot.text))) {
          if (editStatus) editStatus.textContent = "正文已发生变化，请重新选择要修改的片段。";
          closeSentenceTools();
          return;
        }
        const updated = current.slice(0,snapshot.start) + items[index] + current.slice(snapshot.end);
        finalBody.value = updated;
        finalBody.dispatchEvent(new Event("input",{bubbles:true}));
        const paragraph = selectedParagraph();
        if (paragraph) {
          paragraph.textContent = updated;
          paragraph.dataset.wordReady = "false";
          decorateSelectedVersion();
        }
        if (editStatus) editStatus.textContent = `已应用表达版本 ${String.fromCharCode(65 + index)}。`;
        closeSentenceTools();
      });
    });
  };

  const reviseSelection = async (operation, tone = "") => {
    const snapshot = selectionState;
    if (!snapshot || !snapshot.selection.trim()) return;
    closeSentenceTools();
    const results = document.createElement("div");
    results.className = "sentence-results";
    results.innerHTML = `<h3>${operation === "explain" ? "句意与语气" : "正在生成表达"}</h3><div class="sentence-status">${operation === "explain" ? "正在分析当前句子的意思与语气…" : "根据当前句子生成候选版本…"}</div>`;
    document.body.appendChild(results);
    positionFloating(results, snapshot.rect);
    try {
      const response = await fetch("/api/edit-selection", {
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({before:snapshot.text.slice(0,snapshot.start),selection:snapshot.selection,
          after:snapshot.text.slice(snapshot.end),operation,tone,target_context:context?.value || "",
          constraint:document.getElementById("constraint").value})
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "修改失败");
      if (!results.isConnected) return;
      showSentenceResults(operation === "explain" ? "句意与语气" : "候选表达", data, snapshot);
    } catch (error) {
      if (results.isConnected) results.innerHTML = `<h3>暂时无法生成</h3><div class="sentence-status">${escHtml(error.message)}</div>`;
    }
  };

  sentenceToolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "tone") {
      document.querySelectorAll(".sentence-tone-options,.sentence-results").forEach((node) => node.remove());
      const tones = document.createElement("div");
      tones.className = "sentence-tone-options";
      tones.innerHTML = ["更正式","更随和","更委婉","更直接"].map((tone) => `<button type="button" data-tone="${tone}">${tone}</button>`).join("");
      document.body.appendChild(tones);
      positionFloating(tones, sentenceToolbar.getBoundingClientRect());
      tones.addEventListener("click", (toneEvent) => {
        const toneButton = toneEvent.target.closest("[data-tone]");
        if (toneButton) reviseSelection("tone", toneButton.dataset.tone);
      });
      return;
    }
    reviseSelection(action);
  });

  versions.addEventListener("click", (event) => {
    if (!event.target.closest(".version")) return;
    requestAnimationFrame(() => {
      const selected = versions.querySelector(".version.active");
      const translated = selected?.querySelector(".version-translation .translation-text");
      const output = document.getElementById("selectedTranslation");
      if (output && translated) output.textContent = translated.textContent;
    });
  });
  applyFeaturePreferences();

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".word-editor, .word-token")) closeWordEditor();
    if (!event.target.closest(".sentence-toolbar,.sentence-tone-options,.sentence-results,.version")) closeSentenceTools();
  });
});
