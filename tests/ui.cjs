const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:8001';

(async () => {
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    const page = await browser.newPage({viewport:{width:355,height:668}});
    const errors = [], generations = [], edits = [], wordOptions = [], drafts = [];
    page.on('pageerror',(error) => errors.push(error.message));
    await page.route('**/api/extract',(route) => route.fulfill({json:{ok:true,extracted:{
      receiver_name:'',relation:'',purpose:'请求 / 申请',confidence:'medium',note:'请核对'
    }}}));
    await page.route('**/api/process',(route) => {
      generations.push(route.request().postDataJSON());
      return route.fulfill({json:{ok:true,mode:'ai',
        intent:{fact:'想和课程助教讨论计划。',goal:'讨论计划',stance:'请求讨论'},
        context:{relationship:{evidence:'已确认关系'},speech_act:{evidence:'讨论计划'}},
        culture:{target_context:'英国英语语境',profile:{directness:'moderate',mitigation:'moderate',apology:'low',
          explanation:'moderate',responsibility:'moderate',commitment:'moderate',hierarchy:'moderate',relational_warmth:'moderate'},
          boundary_rule:'关系和任务优先，不随意新增承诺。'},
        candidates:{subject:'Discussing the plan',source_translation:'I would like to discuss the plan with you.',
          direct:'Dear Taylor. I would like to discuss the plan. Thank you.',direct_translation:'我想讨论计划。谢谢。',
          polite:'Dear Taylor. I would like to discuss the plan. Thank you.',polite_translation:'我想讨论计划。谢谢。',
          concise:'Taylor, let us discuss the plan. Thanks.',concise_translation:'我们讨论计划吧。谢谢。'},
        check:{status:'PASS',explanation:'请自行核对。'}
      }});
    });
    await page.route('**/api/edit-selection',(route) => {
      edits.push(route.request().postDataJSON());
      return route.fulfill({json:{ok:true,mode:'ai',alternatives:['Could we review the plan together?']}});
    });
    await page.route('**/api/word-options',(route) => {
      wordOptions.push(route.request().postDataJSON());
      return route.fulfill({json:{ok:true,mode:'ai',options:[
        {word:'review',label:'更正式',sentence:'I would like to review the plan.',explanation:'review 可直接接宾语。'},
        {word:'talk',label:'更随和',sentence:'I would like to talk about the plan.',explanation:'talk 后补 about，与 the plan 构成搭配。'}
      ]}});
    });
    await page.route('**/api/revise-sentence',(route) => route.fulfill({json:{ok:true,revised_sentence:'我想和您讨论该计划。'}}));
    await page.route('**/api/email/draft',(route) => {
      drafts.push(route.request().postDataJSON());
      return route.fulfill({json:{ok:true}});
    });

    const current = async () => {
      const panels = page.locator('.stage-content > [data-stage].is-current');
      assert.equal(await panels.count(),1);
      return panels.first().getAttribute('data-stage');
    };
    const assertFit = async () => {
      const m = await page.evaluate(() => ({w:document.documentElement.scrollWidth,vw:innerWidth,
        h:document.documentElement.scrollHeight,vh:innerHeight}));
      assert.ok(m.w <= m.vw + 2,JSON.stringify(m));
      assert.ok(m.h <= m.vh + 2,JSON.stringify(m));
    };

    await page.goto(baseUrl);
    await page.locator('.stage-track').waitFor();
    assert.equal(await page.title(),'Cross Language');
    assert.equal(await page.locator('.head').innerText(),'Cross Language');
    assert.equal(await page.locator('.head').getByRole('heading').count(),1);
    assert.equal(await current(),'setup');
    assert.equal(await page.locator('.product-mode-button').count(),3);
    assert.equal(await page.locator('.product-mode-button[aria-selected="true"]').innerText(),'独立网页端');
    assert.equal(await page.locator('.stage-item').count(),5);
    assert.equal(await page.locator('.stage-controls,#stageNext,#stagePrevious,#stageLocation').count(),0);
    assert.equal(await page.locator('#preferencePanel:visible,#contactPanel:visible').count(),1);
    assert.equal(await page.locator('#workModes,.page-nav,input[name="userProfile"],#wordTab,#stageJump').count(),0);
    assert.equal(await page.locator('#confirmSec #sender_name').count(),0);
    const nav = await page.evaluate(() => ({top:document.querySelector('.stage-nav').getBoundingClientRect().top,
      content:document.querySelector('.stage-content').getBoundingClientRect().top,
      color:getComputedStyle(document.querySelector('.stage-item.is-current'),'::before').backgroundColor}));
    assert.ok(nav.top < nav.content);
    assert.equal(nav.color,'rgb(255, 228, 49)');
    await page.locator('#sender_name').fill('Peppa');
    await page.locator('#choiceAmount').selectOption('single');
    await page.locator('#editingDepth').selectOption('quick');
    assert.equal(await page.locator('#pageSetup').getAttribute('data-mobile-view'),'preferences');
    await page.locator('#preferencesContinue').click();
    assert.equal(await current(),'setup');
    assert.equal(await page.locator('#pageSetup').getAttribute('data-mobile-view'),'contacts');
    await page.locator('.contact-add summary').click();
    await page.locator('#newContactName').fill('Test Taylor');
    await page.locator('#newContactRelation').selectOption('custom');
    await page.locator('#newContactCustomRelation').fill('课程助教');
    await page.locator('#newContactTerms').fill('Project Aurora, Prof. Taylor');
    await page.locator('#addContact').click();
    assert.match(await page.locator('#contactMemory').innerText(),/课程助教/);
    assert.match(await page.locator('#contactHistory').innerText(),/Project Aurora/);
    await assertFit();

    await page.locator('#setupContinue').click();
    assert.equal(await current(),'compose');
    assert.equal(await page.locator('#pageCompose').getAttribute('data-mobile-view'),'message');
    await page.locator('#message').fill('想和课程助教讨论计划。');
    await page.locator('#extract').click();
    await page.locator('#confirmSec:not(.hidden)').waitFor();
    assert.equal(await current(),'compose');
    assert.equal(await page.locator('#pageCompose').getAttribute('data-mobile-view'),'confirm');
    assert.equal(await page.locator('#custom_relation').inputValue(),'课程助教');
    assert.equal(await page.locator('#sender_name').inputValue(),'Peppa');
    for (const id of ['directness','politeness','formality']) {
      assert.equal(await page.locator(`#${id}`).getAttribute('min'),'1');
      assert.equal(await page.locator(`#${id}`).getAttribute('max'),'5');
      assert.match(await page.locator(`#${id}Reading`).innerText(),/[1-5] · .+（1–5：.+）/);
    }
    assert.match(await page.locator('#politenessReading').innerText(),/直接 → 礼貌/);
    await page.locator('#target_context').selectOption({label:'英国英语语境'});
    await page.setViewportSize({width:1440,height:900});
    const composeColumns = await page.evaluate(() => ['messagePanel','confirmSec','stylePanel'].map((id) => {
      const box = document.getElementById(id).getBoundingClientRect();
      return {x:box.x,y:box.y,width:box.width};
    }));
    assert.ok(composeColumns[0].x < composeColumns[1].x && composeColumns[1].x < composeColumns[2].x,JSON.stringify(composeColumns));
    assert.ok(Math.max(...composeColumns.map((item) => item.y)) - Math.min(...composeColumns.map((item) => item.y)) < 3,JSON.stringify(composeColumns));
    if (process.env.COMPOSE_SCREENSHOT) await page.screenshot({path:process.env.COMPOSE_SCREENSHOT});
    await page.setViewportSize({width:355,height:668});
    await page.locator('#confirmContinue').click();
    assert.equal(await current(),'compose');
    assert.equal(await page.locator('#pageCompose').getAttribute('data-mobile-view'),'style');
    assert.equal(await page.locator('#stylePanel:visible').count(),1);
    await page.locator('#directness').fill('5');
    await page.locator('input[name="stylePersistence"][value="default"]').check();
    await page.locator('#run').click();
    await page.locator('#resultStage #versions .version.active').waitFor();
    assert.equal(await current(),'results');
    assert.equal(await page.locator('.head').innerText(),'Cross Language');
    assert.equal(await page.locator('#sourceResult,#expressionOriginal,#sourceTranslationText,.result-tabs').count(),0);
    assert.equal(await page.locator('#cultureSec:visible,#versionSec:visible').count(),2);
    assert.equal(await page.locator('#editStage:visible,#checkSec:visible').count(),0);
    assert.equal(await page.locator('.stage-item[data-jump="refine"]').isEnabled(),false);
    assert.equal(await page.locator('.stage-item[data-jump="draft"]').isEnabled(),false);
    assert.match(await page.locator('#cultureSec .eyebrow').innerText(),/^文化画像/);
    assert.match(await page.locator('#versionSec .eyebrow').innerText(),/^表达生成/);
    assert.match(await page.locator('.culture-narrative').innerText(),/课程助教/);
    assert.equal(await page.locator('#versions .version:visible').count(),1);
    assert.equal(generations[0].sender_name,'Peppa');
    await page.locator('input[name="culturePersistence"][value="default"]').check();
    await page.locator('#cultureToggle').click();
    await page.locator('#culture_directness').fill('5');
    await page.locator('#regenerate').click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('crossLanguageContacts.v1'))?.[0]?.culture?.directness === 5);
    assert.equal(generations[1].culture_overrides.directness,5);
    assert.deepEqual(generations[0].contact_memory.terms,['Project Aurora','Prof. Taylor']);
    await page.setViewportSize({width:1440,height:900});
    await page.getByRole('button',{name:'浏览器 / 客户端内嵌'}).click();
    assert.equal(await page.locator('body').getAttribute('data-product-mode'),'embed');
    assert.equal(await page.locator('#embedSurface:visible').count(),1);
    assert.equal(await page.locator('#embedAgentPopover:visible').count(),0);
    assert.equal(await page.locator('#embedCaretTrigger:visible').count(),0);
    await page.locator('#embedReply').focus();
    await page.locator('#embedCaretTrigger:visible').waitFor();
    const caretUi = await page.evaluate(() => {
      const input = document.getElementById('embedReply').getBoundingClientRect();
      const trigger = document.getElementById('embedCaretTrigger').getBoundingClientRect();
      return {input:{left:input.left,top:input.top,right:input.right,bottom:input.bottom},trigger:{left:trigger.left,top:trigger.top,right:trigger.right,bottom:trigger.bottom}};
    });
    assert.ok(caretUi.trigger.left >= caretUi.input.left && caretUi.trigger.right <= caretUi.input.right + 30,JSON.stringify(caretUi));
    assert.ok(caretUi.trigger.top >= caretUi.input.top && caretUi.trigger.bottom <= caretUi.input.bottom + 30,JSON.stringify(caretUi));
    await page.locator('#embedCaretTrigger').click();
    await page.locator('#embedAgentPopover:visible').waitFor();
    assert.equal(await page.locator('#embedCaretTrigger:visible').count(),0);
    assert.equal(await page.locator('#embedAgentPopover .agent-bar').innerText(),'C\nCross Language\n×');
    assert.match(await page.locator('#embedMailThread .mail-translation').innerText(),/中文翻译.*修改后的项目时间表/s);
    const translationOrder = await page.evaluate(() => {
      const card = document.querySelector('#embedMailThread .mail-card');
      const paragraphs = [...card.querySelectorAll('p')];
      const translation = card.querySelector('.mail-translation');
      return translation.compareDocumentPosition(paragraphs.at(-1)) & Node.DOCUMENT_POSITION_PRECEDING;
    });
    assert.ok(translationOrder);
    assert.match(await page.locator('#embedMemory').innerText(),/已记忆/);
    assert.match(await page.locator('#embedMemory').innerText(),/Project Aurora/);
    const popoverBefore = await page.locator('#embedAgentPopover').boundingBox();
    const popoverHeader = await page.locator('#embedAgentPopover .agent-bar').boundingBox();
    await page.mouse.move(popoverHeader.x + 120,popoverHeader.y + 20);
    await page.mouse.down();
    await page.mouse.move(popoverHeader.x + 50,popoverHeader.y + 80,{steps:8});
    await page.mouse.up();
    const popoverAfter = await page.locator('#embedAgentPopover').boundingBox();
    assert.ok(popoverAfter.x < popoverBefore.x - 30 && popoverAfter.y > popoverBefore.y + 30,JSON.stringify({popoverBefore,popoverAfter}));
    await page.locator('#embedAgentClose').click();
    assert.equal(await page.locator('#embedAgentPopover:visible').count(),0);
    await page.locator('#embedCaretTrigger:visible').waitFor();
    await page.locator('#embedCaretTrigger').click();
    await page.locator('#embedInstruction').fill('确认收到，并说明明天下午给出时间表。');
    await page.locator('#embedGenerate').click();
    await page.locator('#embedResult:not(.hidden)').waitFor();
    await page.locator('[data-fill="embed"]').click();
    assert.match(await page.locator('#embedReply').inputValue(),/Dear Taylor/);
    assert.equal(generations[2].entry_mode,'embed');
    assert.deepEqual(generations[2].contact_memory.terms,['Project Aurora','Prof. Taylor']);
    const embedComposer = await page.evaluate(() => {
      const host = document.querySelector('#embedSurface .host-app').getBoundingClientRect();
      const composer = document.querySelector('#embedSurface .host-composer').getBoundingClientRect();
      const input = document.getElementById('embedReply').getBoundingClientRect();
      const attachment = document.querySelector('#embedSurface .composer-actions .button:first-child').getBoundingClientRect();
      const send = document.querySelector('#embedSurface .composer-actions .button:nth-of-type(2)').getBoundingClientRect();
      return {hostBottom:host.bottom,composerBottom:composer.bottom,attachment:{x:attachment.x,y:attachment.y,width:attachment.width,height:attachment.height},input:{x:input.x,y:input.y,width:input.width,height:input.height},send:{x:send.x,y:send.y,width:send.width,height:send.height}};
    });
    assert.ok(Math.abs(embedComposer.hostBottom - embedComposer.composerBottom) < 3,JSON.stringify(embedComposer));
    assert.ok(embedComposer.attachment.x + embedComposer.attachment.width < embedComposer.input.x,JSON.stringify(embedComposer));
    assert.ok(embedComposer.send.x > embedComposer.input.x + embedComposer.input.width,JSON.stringify(embedComposer));
    assert.ok(embedComposer.attachment.y >= embedComposer.input.y && embedComposer.attachment.y + embedComposer.attachment.height <= embedComposer.input.y + embedComposer.input.height + 2,JSON.stringify(embedComposer));
    assert.ok(embedComposer.send.y >= embedComposer.input.y && embedComposer.send.y + embedComposer.send.height <= embedComposer.input.y + embedComposer.input.height + 2,JSON.stringify(embedComposer));
    const floatingAgent = await page.locator('#embedAgentPopover').boundingBox();
    assert.ok(floatingAgent.x >= 12 && floatingAgent.y >= 12 && floatingAgent.x + floatingAgent.width <= 1441 && floatingAgent.y + floatingAgent.height <= 901,JSON.stringify(floatingAgent));
    await page.setViewportSize({width:466,height:702});
    const compactComposer = await page.evaluate(() => {
      const attachment = document.querySelector('#embedSurface .composer-actions .button:first-child').getBoundingClientRect();
      const input = document.getElementById('embedReply').getBoundingClientRect();
      const send = document.querySelector('#embedSurface .composer-actions .button:nth-of-type(2)').getBoundingClientRect();
      return {attachment:{x:attachment.x,right:attachment.right},input:{x:input.x,right:input.right},send:{x:send.x,right:send.right}};
    });
    assert.ok(compactComposer.attachment.right < compactComposer.input.x && compactComposer.input.right < compactComposer.send.x,JSON.stringify(compactComposer));
    await page.setViewportSize({width:1440,height:900});
    await assertFit();
    if (process.env.EMBED_SCREENSHOT) await page.screenshot({path:process.env.EMBED_SCREENSHOT});
    await page.getByRole('button',{name:'双窗口关联联动'}).click();
    assert.equal(await page.locator('body').getAttribute('data-product-mode'),'split');
    assert.equal(await page.locator('#splitSurface:visible').count(),1);
    assert.match(await page.locator('#splitSyncBadge').innerText(),/3 条/);
    assert.match(await page.locator('#syncedContext').innerText(),/design review/);
    await page.locator('#splitInstruction').fill('周四上午可以，但希望十点以后。');
    await page.locator('#splitGenerate').click();
    await page.locator('#splitResult:not(.hidden)').waitFor();
    const splitResultStyle = await page.locator('#splitResult').evaluate((node) => ({position:getComputedStyle(node).position,rect:node.getBoundingClientRect().toJSON()}));
    assert.equal(splitResultStyle.position,'fixed');
    assert.ok(splitResultStyle.rect.x >= 12 && splitResultStyle.rect.y >= 12 && splitResultStyle.rect.right <= 1441 && splitResultStyle.rect.bottom <= 901,JSON.stringify(splitResultStyle));
    const splitResultBefore = await page.locator('#splitResult').boundingBox();
    const splitResultHeader = await page.locator('#splitResult .light-result-head').boundingBox();
    await page.mouse.move(splitResultHeader.x + 90,splitResultHeader.y + 18);
    await page.mouse.down();
    await page.mouse.move(splitResultHeader.x - 30,splitResultHeader.y - 50,{steps:8});
    await page.mouse.up();
    const splitResultAfter = await page.locator('#splitResult').boundingBox();
    assert.ok(splitResultAfter.x < splitResultBefore.x - 60 && splitResultAfter.y < splitResultBefore.y - 25,JSON.stringify({splitResultBefore,splitResultAfter}));
    await page.locator('#splitResultClose').click();
    assert.equal(await page.locator('#splitResult:visible').count(),0);
    await page.locator('#splitGenerate').click();
    await page.locator('#splitResult:not(.hidden)').waitFor();
    await page.locator('[data-fill="split"]').click();
    assert.match(await page.locator('#splitReply').inputValue(),/Dear Taylor/);
    assert.equal(generations[3].entry_mode,'split');
    assert.equal(generations[4].entry_mode,'split');
    assert.match(generations[4].message,/We need to book the room/);
    const splitColumns = await page.evaluate(() => ['#splitSurface .host-app','#splitSurface .light-agent'].map((selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return {x:box.x,y:box.y,width:box.width};
    }));
    assert.ok(splitColumns[0].x < splitColumns[1].x,JSON.stringify(splitColumns));
    assert.ok(Math.abs(splitColumns[0].y - splitColumns[1].y) < 3,JSON.stringify(splitColumns));
    await assertFit();
    if (process.env.SPLIT_SCREENSHOT) await page.screenshot({path:process.env.SPLIT_SCREENSHOT});
    await page.getByRole('button',{name:'独立网页端'}).click();
    assert.equal(await page.locator('body').getAttribute('data-product-mode'),'web');
    assert.equal(await page.locator('.stage-nav:visible').count(),1);
    await assertFit();
    await page.setViewportSize({width:1440,height:900});
    await assertFit();
    const columns = await page.evaluate(() => ['cultureSec','versionSec'].map((id) => {
      const box = document.getElementById(id).getBoundingClientRect();
      return {x:box.x,y:box.y,width:box.width};
    }));
    assert.ok(columns[0].x < columns[1].x,JSON.stringify(columns));
    assert.ok(Math.max(...columns.map((item) => item.y)) - Math.min(...columns.map((item) => item.y)) < 3,JSON.stringify(columns));
    const widths = await page.evaluate(() => ({version:document.querySelector('#versions .version.active').getBoundingClientRect().width,
      versions:document.getElementById('versions').getBoundingClientRect().width}));
    assert.ok(widths.version >= widths.versions - 2,JSON.stringify(widths));
    if (process.env.RESULT_SCREENSHOT) await page.screenshot({path:process.env.RESULT_SCREENSHOT});
    await page.locator('#confirmVersion').click();
    assert.equal(await current(),'refine');
    assert.equal(await page.locator('#editStage:visible,#checkSec:visible').count(),2);
    assert.equal(await page.locator('#quickPrepareDraft:visible,#prepareDraft:visible').count(),1);
    const bodyHeight = () => page.locator('#finalBody').evaluate((field) => ({height:field.getBoundingClientRect().height,
      scrollHeight:field.scrollHeight,overflow:getComputedStyle(field).overflowY}));
    const shortBody = await bodyHeight();
    assert.ok(shortBody.height < 160,JSON.stringify(shortBody));
    await page.locator('#finalBody').fill(Array(30).fill('A longer sentence for careful review.').join('\n'));
    const longBody = await bodyHeight();
    assert.ok(longBody.height > shortBody.height && longBody.height <= 281 && longBody.overflow === 'auto',JSON.stringify({shortBody,longBody}));
    await page.locator('#finalBody').fill('Short note.');
    const shrunkBody = await bodyHeight();
    assert.ok(shrunkBody.height < longBody.height && shrunkBody.height <= 90,JSON.stringify({longBody,shrunkBody}));
    await page.locator('#finalBody').fill('Dear Taylor. I would like to discuss the plan. Thank you.');
    const refineColumns = await page.evaluate(() => ['editStage','reviewStage'].map((id) => document.getElementById(id).getBoundingClientRect().x));
    assert.ok(refineColumns[0] < refineColumns[1],JSON.stringify(refineColumns));
    if (process.env.REFINE_SCREENSHOT) await page.screenshot({path:process.env.REFINE_SCREENSHOT});
    await page.locator('#quickPrepareDraft').click();
    assert.equal(await current(),'draft');
    await page.locator('.stage-item[data-jump="setup"]').click();
    await page.locator('#requireReview').check();
    await page.locator('.stage-item[data-jump="refine"]').click();
    await page.locator('#meaningAccepted').check();
    assert.equal(await page.locator('#prepareDraft').isVisible(),true);
    assert.equal(await page.locator('#quickPrepareDraft').isVisible(),false);
    await page.locator('#changeVersion').click();
    assert.equal(await current(),'results');
    assert.equal(await page.locator('#meaningAccepted').isChecked(),false);
    assert.equal(await page.locator('#prepareDraft').isVisible(),false);
    assert.equal(await page.locator('.stage-item[data-jump="refine"]').isEnabled(),false);
    await page.locator('#confirmVersion').click();
    assert.equal(await current(),'refine');
    await page.locator('.stage-item[data-jump="draft"]').click();
    assert.equal(await current(),'refine');
    await page.locator('#meaningAccepted').check();
    assert.equal(await page.locator('#prepareDraft').isVisible(),true);
    await page.setViewportSize({width:355,height:668});
    await page.locator('#prepareDraft').click();
    assert.equal(await current(),'draft');

    await page.locator('.stage-item[data-jump="setup"]').click();
    await page.locator('#choiceAmount').selectOption('compare');
    await page.locator('#editingDepth').selectOption('detailed');
    await page.locator('#requireReview').check();
    await page.locator('.stage-item[data-jump="results"]').click();
    await page.locator('#rechooseVersion').click();
    assert.equal(await page.locator('#versions .version:visible').count(),3);
    assert.equal(await page.locator('#editStage:visible,#reviewStage:visible').count(),0);
    await page.locator('#confirmVersion').click();
    assert.equal(await current(),'refine');
    assert.equal(await page.locator('#editStage:visible,#reviewStage:visible').count(),2);
    await page.locator('#sentenceSelect').selectOption('1');
    await page.locator('[data-inline-action="tone"]').click();
    const toneGap = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('inlineTone')).marginTop));
    assert.ok(toneGap >= 14,toneGap);
    await page.locator('[data-inline-action="rewrite"]').click();
    await page.locator('#inlineEditResult .sentence-result').first().click();
    assert.equal(await page.locator('#finalBody').inputValue(),'Dear Taylor. Could we review the plan together? Thank you.');
    assert.equal(edits[0].before,'Dear Taylor. ');
    assert.equal(edits[0].after,' Thank you.');
    await page.locator('#finalBody').fill('Dear Taylor. I would like to discuss the plan. Thank you.');
    await page.locator('#editPreview .word-token').filter({hasText:'discuss'}).first().click();
    await page.locator('.word-editor .word-editor-collapse').click();
    assert.equal(await page.locator('.word-editor').getAttribute('class'),'word-editor is-collapsed');
    assert.equal(await page.locator('.word-editor .word-editor-collapse').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('.word-editor > :not(.word-editor-topbar):visible').count(),0);
    await page.locator('.word-editor .word-editor-collapse').click();
    assert.equal(await page.locator('.word-editor').getAttribute('class'),'word-editor');
    assert.equal(await page.locator('.word-editor .word-editor-collapse').getAttribute('aria-expanded'),'true');
    await page.locator('.word-editor .word-alternatives:visible').waitFor();
    await page.locator('.word-alt').nth(1).click();
    const mobileBefore = await page.locator('.word-editor').boundingBox();
    const mobileHeader = await page.locator('.word-editor-topbar').boundingBox();
    await page.mouse.move(mobileHeader.x + 80,mobileHeader.y + 20);
    await page.mouse.down();
    await page.mouse.move(mobileHeader.x + 80,mobileHeader.y + 85,{steps:8});
    await page.mouse.up();
    const mobileAfter = await page.locator('.word-editor').boundingBox();
    assert.ok(mobileAfter.y > mobileBefore.y + 30,JSON.stringify({mobileBefore,mobileAfter}));
    await page.setViewportSize({width:1280,height:800});
    const dragBefore = await page.locator('.word-editor').boundingBox();
    const header = await page.locator('.word-editor-topbar').boundingBox();
    await page.mouse.move(header.x + 90,header.y + 20);
    await page.mouse.down();
    await page.mouse.move(header.x + 200,header.y + 80,{steps:8});
    await page.mouse.up();
    const dragAfter = await page.locator('.word-editor').boundingBox();
    assert.ok(dragAfter.x > dragBefore.x + 50 && dragAfter.y > dragBefore.y + 30,JSON.stringify({dragBefore,dragAfter}));
    await page.setViewportSize({width:355,height:668});
    await page.waitForFunction(() => {
      const rect = document.querySelector('.word-editor')?.getBoundingClientRect();
      return rect && rect.left >= 11 && rect.right <= innerWidth - 11;
    });
    const compactEditor = await page.locator('.word-editor').boundingBox();
    assert.ok(compactEditor.x >= 11 && compactEditor.x + compactEditor.width <= 356,JSON.stringify(compactEditor));
    assert.match(await page.locator('.word-alt').nth(1).innerText(),/talk\s*（更随和）/);
    assert.equal(await page.locator('.word-revised-sentence').innerText(),'I would like to talk about the plan.');
    assert.match(await page.locator('.word-grammar-note').innerText(),/补 about/);
    await page.locator('.word-editor .apply-suggestion').click();
    await page.waitForFunction(() => document.querySelector('#finalBody').value.includes('talk about'));
    assert.equal(wordOptions[0].word,'discuss');
    assert.equal(wordOptions[0].before,'Dear Taylor. ');
    await assertFit();
    assert.equal(await page.locator('#prepareDraft').isVisible(),false);
    assert.match(await page.locator('#meaningStatus').innerText(),/重新核对/);
    await page.locator('.stage-item[data-jump="draft"]').click();
    assert.equal(await current(),'refine');
    await page.locator('#meaningAccepted').check();
    assert.equal(await page.locator('#prepareDraft').isVisible(),true);
    await page.locator('#prepareDraft').click();
    assert.equal(await current(),'draft');
    assert.equal(await page.locator('#writeAnother').isVisible(),false);
    await page.locator('#mailTo').fill('recipient@example.com');
    await page.locator('#mailSubject').fill('Discussing the plan');
    await page.locator('#saveDraft').click();
    await page.locator('#writeAnother.is-visible').waitFor();
    assert.equal(drafts.length,1);
    assert.match(drafts[0].body,/talk about the plan/);
    await page.locator('#writeAnother').click();
    assert.equal(await current(),'compose');
    assert.equal(await page.locator('#pageCompose').getAttribute('data-mobile-view'),'message');
    assert.equal(await page.locator('#message').inputValue(),'');
    assert.equal(await page.locator('#finalBody').inputValue(),'');
    assert.equal(await page.locator('#confirmSec').isVisible(),false);
    assert.equal(await page.locator('#meaningAccepted').isChecked(),false);
    assert.equal(await page.locator('#sender_name').inputValue(),'Peppa');
    assert.match(await page.locator('#contactMemory').innerText(),/课程助教/);
    assert.equal(await page.locator('.stage-item[data-jump="draft"]').isEnabled(),false);
    await page.setViewportSize({width:1280,height:800});
    await assertFit();

    await page.reload();
    assert.equal(await page.locator('#choiceAmount').inputValue(),'compare');
    assert.equal(await page.locator('#requireReview').isChecked(),true);
    assert.equal(await page.locator('#sender_name').inputValue(),'Peppa');
    await page.locator('#contactSelect').selectOption({label:'Test Taylor'});
    assert.equal(await page.locator('#directness').inputValue(),'5');
    assert.match(await page.locator('#contactMemory').innerText(),/默认文化画像：直接 5\/5/);
    assert.match(await page.locator('#contactHistory').innerText(),/最近沟通/);
    page.once('dialog',(dialog) => dialog.accept());
    await page.locator('#removeContact').click();
    await page.reload();
    assert.equal(await page.locator('#contactSelect option').count(),1);
    assert.deepEqual(errors,[]);
    console.log('PASS: grouped pages, progress, adaptive views, contextual edits, review gate, draft restart, viewport fit');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
