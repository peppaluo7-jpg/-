(function () {
  const host = window.location.hostname;
  const params = new URLSearchParams(window.location.search);
  const enabled = /(^|\.)github\.io$/i.test(host) || params.has("static-demo");
  if (!enabled) return;

  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
  const readBody = (options) => {
    try { return JSON.parse(options?.body || "{}"); } catch (_) { return {}; }
  };
  const classifyPurpose = (message) => {
    if (/延期|延后|申请|请求/.test(message)) return "请求 / 申请";
    if (/抱歉|对不起|道歉/.test(message)) return "道歉";
    if (/拒绝|不能|无法/.test(message)) return "拒绝";
    if (/提醒|别忘|截止/.test(message)) return "提醒";
    if (/不同意|异议|不太赞同/.test(message)) return "表达不同意见";
    return "解释 / 进度说明";
  };
  const classifyRelation = (message) => {
    if (/老师|导师|教授/.test(message)) return "导师 / 教授";
    if (/上级|领导|经理/.test(message)) return "上级";
    if (/同事/.test(message)) return "同事";
    if (/客户|合作方/.test(message)) return "合作对象";
    if (/朋友/.test(message)) return "朋友";
    return "";
  };
  const extract = (data) => {
    const message = String(data.message || "").trim();
    return {
      ok: true,
      mode: "demo",
      warning: "GitHub Pages 静态演示不会发送内容到 AI 服务，请逐项核对结果。",
      extracted: {
        sender_name: "",
        receiver_name: "",
        relation: classifyRelation(message),
        purpose: classifyPurpose(message),
        confidence: "medium",
        needs_confirmation: true,
        note: "已从原文提取可识别信息；空白项请由你补充。"
      }
    };
  };
  const process = (data) => {
    const message = String(data.message || "").trim();
    const relation = data.relation || "合作对象";
    const purpose = data.purpose || "完成跨语言沟通";
    const name = data.receiver_name ? ` ${data.receiver_name}` : "";
    const source = message || "这是一段跨语言沟通内容。";
    const subject = purpose === "请求 / 申请" ? "A request for your consideration" : "A quick update";
    return {
      ok: true,
      mode: "demo",
      warning: "当前为 GitHub Pages 静态演示，表达内容仅用于展示流程，不能直接发送。",
      intent: { fact: source, goal: purpose, stance: "保持用户原本的请求或协商立场" },
      context: {
        relationship: { relative_power: /导师|上级/.test(relation) ? "higher_receiver" : "equal_or_unknown", evidence: `用户选择关系：${relation}` },
        speech_act: { type: purpose, evidence: "依据用户选择的沟通目的与事件内容" }
      },
      culture: {
        target_context: data.target_context || "不确定 / 通用国际英语",
        profile: { directness: "moderate", mitigation: "moderate", apology: "do_not_add_without_confirmation", explanation: "concise", responsibility: "do_not_add_without_confirmation", commitment: "do_not_add_without_confirmation", hierarchy: "context-sensitive", relational_warmth: "moderate" },
        boundary_rule: "文化只调整怎么说，不改变用户原意；新增道歉、责任、承诺、妥协必须确认。"
      },
      candidates: {
        subject,
        source_translation: "静态演示：这里会显示忠实中文对照。",
        direct: `I would like to discuss this with you${name}.`,
        direct_translation: "我想和你讨论这件事。",
        polite: `I would appreciate the opportunity to discuss this with you${name}.`,
        polite_translation: "如果可以，我希望和你讨论这件事。",
        concise: `Could we discuss this${name}?`,
        concise_translation: "我们可以讨论这件事吗？"
      },
      check: {
        status: "NEED_REVISION",
        flags: [{ type: "静态演示", version: "全部", detail: "GitHub Pages 不连接 AI，无法验证事实、语法和文化适配；发送前请人工核对。" }],
        explanation: "这是公开静态演示，不会调用或暴露 API Key。"
      }
    };
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (resource, options) {
    const url = typeof resource === "string" ? resource : resource.url;
    if (!url.includes("/api/")) return nativeFetch(resource, options);
    const data = readBody(options);
    if (url.includes("/api/health")) return Promise.resolve(json({ ok: true, ai_configured: false, mode: "static-demo" }));
    if (url.includes("/api/extract")) return Promise.resolve(json(extract(data)));
    if (url.includes("/api/process")) return Promise.resolve(json(process(data)));
    if (url.includes("/api/revise-sentence")) return Promise.resolve(json({ ok: true, mode: "demo", revised_sentence: data.sentence || "" }));
    if (url.includes("/api/edit-selection")) return Promise.resolve(json({ ok: true, mode: "demo", alternatives: [data.selection || ""], explanation: "静态演示不提供可靠的局部改写建议。" }));
    if (url.includes("/api/word-options")) return Promise.resolve(json({ ok: true, mode: "demo", options: [], warning: "静态演示不提供未经整句校对的逐词候选。" }));
    if (url.includes("/api/email/draft")) return Promise.resolve(json({ ok: false, error: "GitHub Pages 静态演示不连接 QQ 邮箱，请复制内容后手动保存。" }, 400));
    return Promise.resolve(json({ ok: false, error: "此功能需要本地 Python 服务。" }, 404));
  };
})();
