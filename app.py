
import json
import imaplib
import os
import re
import time
import urllib.request
from email.message import EmailMessage
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"

# ---- lightweight .env loader (no third-party package needed) ----
env_path = ROOT / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/")
QQ_EMAIL = os.getenv("QQ_EMAIL", "").strip()
QQ_EMAIL_AUTH_CODE = os.getenv("QQ_EMAIL_AUTH_CODE", "").strip()
QQ_IMAP_HOST = os.getenv("QQ_IMAP_HOST", "imap.qq.com").strip()
QQ_IMAP_PORT = int(os.getenv("QQ_IMAP_PORT", "993"))

if OPENAI_BASE_URL.endswith("/responses"):
    RESPONSE_URL = OPENAI_BASE_URL
else:
    RESPONSE_URL = f"{OPENAI_BASE_URL}/responses"

if OPENAI_BASE_URL.endswith("/chat/completions"):
    CHAT_COMPLETIONS_URL = OPENAI_BASE_URL
else:
    CHAT_COMPLETIONS_URL = f"{OPENAI_BASE_URL}/chat/completions"

def extract_text(resp_json):
    texts = []
    for item in resp_json.get("output", []):
        for c in item.get("content", []):
            if c.get("type") == "output_text" and c.get("text"):
                texts.append(c["text"])
    return "\n".join(texts).strip()

def extract_chat_text(resp_json):
    try:
        choices = resp_json.get("choices", [])
        if not choices:
            return ""
        message = choices[0].get("message", {})
        content = message.get("content")
        if isinstance(content, list):
            texts = []
            for item in content:
                if isinstance(item, dict):
                    texts.append(item.get("text", ""))
            return "\n".join(t for t in texts if t).strip()
        if isinstance(content, str):
            return content.strip()
        return ""
    except Exception:
        return ""


def call_model(instructions, payload, stage="model"):
    if not API_KEY:
        raise RuntimeError("OPENAI_API_KEY 未配置")

    def post_json(url, body, protocol):
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            method="POST"
        )
        proxy_values = [os.getenv(name, "") for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY")]
        placeholder_proxy = any(value.rstrip("/").endswith("127.0.0.1:9") for value in proxy_values)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if placeholder_proxy else urllib.request.build_opener()
        for attempt in range(2):
            started = time.perf_counter()
            try:
                with opener.open(req, timeout=120) as r:
                    raw = r.read().decode("utf-8", "ignore")
                break
            except HTTPError as e:
                print(f"[llm] stage={stage} protocol={protocol} status={e.code} seconds={time.perf_counter() - started:.2f}", flush=True)
                raise
            except Exception as e:
                elapsed = time.perf_counter() - started
                transient = elapsed < 3 and any(marker in str(e).lower() for marker in
                    ("unexpected_eof", "connection reset", "connection aborted", "timed out"))
                print(f"[llm] stage={stage} protocol={protocol} status={'retry' if transient and attempt == 0 else 'error'} seconds={elapsed:.2f}", flush=True)
                if not transient or attempt: raise
                time.sleep(0.4)
        print(f"[llm] stage={stage} protocol={protocol} status=ok seconds={time.perf_counter() - started:.2f}", flush=True)
        if not raw.strip():
            raise RuntimeError("API 返回为空内容")
        if raw.lstrip().startswith("<") or "<!doctype html" in raw.lower() or "<html" in raw.lower():
            raise RuntimeError(
                f"当前 OPENAI_BASE_URL 指向的不是 OpenAI 兼容 API。服务返回的是 HTML 页面，而不是 JSON。请确认该地址是否是 API 入口，例如 https://xxx/v1，并不是普通网站主页。当前地址：{url}。"
            )
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise RuntimeError(
                f"API 返回不是合法 JSON：{raw[:300]}。这通常说明 OPENAI_BASE_URL 错了，或者该服务不支持 OpenAI 兼容协议。当前地址：{url}."
            ) from e

    try_payload = {
        "model": MODEL,
        "store": False,
        "instructions": instructions,
        "input": json.dumps(payload, ensure_ascii=False)
    }

    try:
        result = post_json(RESPONSE_URL, try_payload, "responses")
        text = extract_text(result)
        if text:
            return text
    except HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "ignore")
        except Exception:
            pass
        detail = re.sub(r"\s+", " ", detail).strip()
        if e.code in (404, 405):
            pass
        else:
            raise RuntimeError(
                f"API 鉴权失败（{e.code}）。请检查 OPENAI_API_KEY、OPENAI_MODEL 和 OPENAI_BASE_URL。当前模型：{MODEL}，当前地址：{OPENAI_BASE_URL}."
                + (f" API 返回：{detail[:200]}" if detail else "")
            ) from e

    chat_payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}
        ],
        "temperature": 0.2
    }

    try:
        result = post_json(CHAT_COMPLETIONS_URL, chat_payload, "chat_completions")
        text = extract_chat_text(result)
        if not text:
            raise RuntimeError("模型没有返回文本")
        return text
    except HTTPError as e:
        try:
            detail = e.read().decode("utf-8", "ignore")
        except Exception:
            detail = ""
        detail = re.sub(r"\s+", " ", detail).strip()
        if e.code == 401:
            raise RuntimeError(
                f"API 鉴权失败（401 Unauthorized）。请检查 OPENAI_API_KEY 是否正确；若你用的是非官方兼容服务，请确认 OPENAI_BASE_URL 指向正确地址，并确认该服务支持 OpenAI 兼容格式。当前模型：{MODEL}，当前地址：{OPENAI_BASE_URL}."
                + (f" API 返回：{detail[:200]}" if detail else "")
            ) from e
        raise RuntimeError(
            f"API 请求失败（{e.code}）。请检查 OPENAI_API_KEY、OPENAI_MODEL 和 OPENAI_BASE_URL。当前模型：{MODEL}，当前地址：{OPENAI_BASE_URL}."
            + (f" API 返回：{detail[:200]}" if detail else "")
        ) from e
    except URLError as e:
        raise RuntimeError(f"OpenAI API 网络连接失败：{e.reason}。请确认网络和代理设置。") from e

def parse_json_loose(text):
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        s, e = text.find("{"), text.rfind("}")
        if s >= 0 and e > s:
            return json.loads(text[s:e+1])
        raise

def demo_extract(data):
    message = (data.get("message") or "").strip()
    receiver_name = ""
    sender_name = ""
    for pattern in [r"(?:给|向|对)([A-Za-z][A-Za-z .'-]{1,30})(?:老师|教授|导师|经理|先生|女士)?", r"(?:收件人|对方)[:：]\s*([^，。\n]+)"]:
        match = re.search(pattern, message)
        if match:
            receiver_name = match.group(1).strip()
            break
    for pattern in [r"(?:我是|我叫|发件人)[:：]?\s*([\u4e00-\u9fffA-Za-z· .'-]{2,20})"]:
        match = re.search(pattern, message)
        if match:
            sender_name = match.group(1).strip().rstrip("，。")
            break
    purpose = ""
    purpose_rules = [
        ("请求 / 申请", ["申请", "请求", "能不能", "可以吗", "延期"]),
        ("道歉", ["道歉", "对不起", "抱歉"]),
        ("拒绝", ["拒绝", "无法接受", "不能参加"]),
        ("提醒", ["提醒", "别忘", "截止"]),
        ("表达不同意见", ["不同意", "不同意见", "不太赞同"]),
        ("解释 / 进度说明", ["进度", "说明", "解释"]),
    ]
    for label, keywords in purpose_rules:
        if any(keyword in message for keyword in keywords):
            purpose = label
            break
    relation = ""
    for label, keywords in [
        ("导师 / 教授", ["老师", "导师", "教授"]), ("上级", ["上级", "领导", "经理"]),
        ("同事", ["同事"]), ("合作对象", ["客户", "合作方"]), ("朋友", ["朋友"])
    ]:
        if any(keyword in message for keyword in keywords):
            relation = label
            break
    return {
        "sender_name": sender_name, "receiver_name": receiver_name,
        "relation": relation, "purpose": purpose,
        "confidence": "medium", "needs_confirmation": True,
        "note": "已从原文提取可识别信息；空白项请由你补充。"
    }

def extract_info(data):
    if not (data.get("message") or "").strip():
        return {"ok": False, "error": "请先输入要沟通的内容"}
    if not API_KEY:
        return {"ok": True, "mode": "demo", "extracted": demo_extract(data)}
    prompt = """
你是信息提取 Agent。只从用户原文中提取信息，不推测、不润色。
返回 JSON：sender_name, receiver_name, relation, purpose, confidence, needs_confirmation, note。
relation 只能是：导师 / 教授、同事、合作对象、上级、朋友或空字符串。
purpose 只能是：请求 / 申请、道歉、拒绝、提醒、表达不同意见、解释 / 进度说明或空字符串。
没有明确出现的姓名必须返回空字符串；confidence 为 high、medium 或 low。
"""
    extracted = parse_json_loose(call_model(prompt, {"message": data["message"]}, stage="extract"))
    return {"ok": True, "mode": "ai", "extracted": extracted}

def demo_intent(data):
    raw = data["message"]
    relation = data["relation"]
    target = data["target_context"]
    purpose = data["purpose"]
    constraint = data.get("constraint","").strip()
    return {
        "fact": raw,
        "goal": purpose or "完成跨语言沟通",
        "stance": "保持用户原本的请求/协商立场",
        "explicit_constraints": [constraint] if constraint else [],
        "inferred_concerns": ["避免显得像在找借口"] if "借口" in raw else [],
        "speaker_role": data.get("sender_name") or "用户",
        "receiver_role": data.get("receiver_name") or relation,
        "target_context": target
    }

def demo_context(intent, data):
    rel = data["relation"]
    power = "higher_receiver" if ("导师" in rel or "上级" in rel) else "equal_or_unknown"
    speech = data["purpose"] or "请求"
    imposition = "high" if any(x in speech for x in ["延期","拒绝","不同意见"]) else "medium"
    return {
        "relationship": {
            "relative_power": power,
            "social_distance": "medium",
            "evidence": f"用户手动选择关系：{rel}"
        },
        "speech_act": {
            "type": speech,
            "imposition": imposition,
            "evidence": "依据用户选择的沟通目的与事件内容"
        }
    }

def demo_culture(data, context):
    target = data["target_context"]
    scenario = data.get("scenario", "general")
    return {
        "target_context": target,
        "profile": {
            "directness": "moderate",
            "mitigation": "moderate",
            "apology": "do_not_add_without_confirmation",
            "explanation": "concise",
            "responsibility": "do_not_add_without_confirmation",
            "commitment": "do_not_add_without_confirmation",
            "hierarchy": "context-sensitive",
            "relational_warmth": "moderate"
        },
        "rule": "文化只调整怎么说，不改变用户原意；新增道歉、责任、承诺、妥协必须确认。",
        "scenario_note": {"request_to_superior":"向导师或上级提出请求：先说明事实，再提出清晰请求，避免过度道歉或虚构承诺。","refusal_or_disagreement":"跨文化拒绝或异议：明确表达边界，同时保留合作信号，不把委婉写成模糊同意。"}.get(scenario,"根据关系、权力距离和言语行为调整表达，不套用固定文化刻板印象。")
    }

def demo_candidates(intent, context, culture, data):
    unavailable = "Demo 占位：AI 未生成可靠表达。请核对原文，不要将此内容直接发送。"
    return {
        "subject": "",
        "source_translation": "Demo 模式无法忠实翻译原文；请等待 AI 生成或人工翻译。",
        "direct": unavailable,
        "polite": unavailable,
        "concise": unavailable
    }

def demo_check(intent, candidates):
    return {
        "status":"NEED_REVISION",
        "flags":[{"type":"未完成检查", "version":"全部", "detail":"Demo 模式无法验证事实、语法和文化适配；请勿直接发送占位内容。"}],
        "explanation":"AI 未完成真实性检查。"
    }

def build_demo_result(data, warning=""):
    intent = demo_intent(data)
    context = demo_context(intent, data)
    culture = demo_culture(data, context)
    candidates = demo_candidates(intent, context, culture, data)
    check = demo_check(intent, candidates)
    result = {
        "ok": True, "mode": "demo", "intent": intent, "context": context,
        "culture": culture, "candidates": candidates, "check": check
    }
    if warning:
        result["warning"] = warning
    return result

def run_pipeline(data):
    required = ["message","relation","target_context","purpose"]
    for k in required:
        if not (data.get(k) or "").strip():
            return {"ok":False,"error":f"缺少必要信息：{k}"}

    if not API_KEY:
        return build_demo_result(data)

    prompt = """
你是跨语言关系沟通助手。一次完成意图、关系、文化画像、表达与生成时自检，仅返回严格 JSON，不要 Markdown。
用户明确填写的关系、目的、目标语境和表达尺度优先于地域倾向；文化只是软先验，不可套用刻板印象。
保持 message 的事实、请求/拒绝立场和 constraint。不得虚构姓名、日期或新增道歉、责任、承诺、妥协。
contact_memory 仅包含用户已保存的专属词汇和最近沟通记录：terms 可用于保持双方惯用称呼与专属指代一致；recent_history 只作为语气和连续性参考，
不能把历史记录里的旧事实、日期、请求或承诺带入本次表达。entry_mode 只表示界面入口，不得改变事实边界。
source_translation 忠实译成 target_context 的语言，不做文化润色；三个候选 direct/polite/concise 也用目标语言，
各自的 *_translation 用简体中文忠实解释。style_controls 的直接、礼貌、正式均为 1-5；culture_overrides 是人工确认的八项 1-5 值，应优先采用，但不能改变事实或用户边界。
先在内部核对候选是否偏离原文及约束；若不确定或有风险，在 check.flags 标记，check.status 设为 NEED_REVISION。
请紧凑返回以下结构，每个字段都必须存在：
{
 "intent":{"fact":"","goal":"","stance":""},
 "context":{"relationship":{"evidence":""},"speech_act":{"evidence":""}},
 "culture":{"target_context":"","profile":{"directness":"moderate","mitigation":"moderate","apology":"low","explanation":"moderate","responsibility":"moderate","commitment":"moderate","hierarchy":"moderate","relational_warmth":"moderate"},"boundary_rule":""},
 "candidates":{"subject":"","source_translation":"","direct":"","direct_translation":"","polite":"","polite_translation":"","concise":"","concise_translation":""},
 "check":{"status":"PASS","flags":[],"explanation":""}
}
profile 值可为 very_high/high/moderate/low/avoid；需要时在 boundary_rule 简要说明依据。check 为同次生成自检，不是独立模型复核。
"""
    result = parse_json_loose(call_model(prompt, data, stage="communication"))
    if not isinstance(result, dict):
        raise RuntimeError("AI 返回的生成结果格式不正确")
    for section in ("intent", "context", "culture", "candidates", "check"):
        if not isinstance(result.get(section), dict):
            raise RuntimeError(f"AI 返回缺少 {section}")
    culture = result["culture"]
    if not isinstance(culture.get("profile"), dict) or not all(
        culture["profile"].get(key) for key in
        ("directness", "mitigation", "apology", "explanation", "responsibility",
         "commitment", "hierarchy", "relational_warmth")
    ):
        raise RuntimeError("AI 返回的文化画像不完整")
    candidates = result["candidates"]
    if not all(isinstance(candidates.get(key), str) and candidates[key].strip() for key in
               ("source_translation", "direct", "direct_translation", "polite",
                "polite_translation", "concise", "concise_translation")):
        raise RuntimeError("AI 返回的表达或译文不完整")
    check = result["check"]
    if check.get("status") not in ("PASS", "NEED_REVISION") or not isinstance(check.get("flags"), list):
        raise RuntimeError("AI 返回的风险自检不完整")
    culture["target_context"] = data["target_context"]
    result.update(ok=True, mode="ai")
    return result

def create_qq_draft(data):
    if not QQ_EMAIL or not QQ_EMAIL_AUTH_CODE:
        raise RuntimeError("QQ 邮箱或授权码未配置")
    recipient = (data.get("to") or "").strip()
    subject = (data.get("subject") or "").strip()
    content = (data.get("body") or "").strip()
    if not recipient or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", recipient):
        raise ValueError("请填写正确的收件邮箱")
    if not subject:
        raise ValueError("请填写邮件主题")
    if not content:
        raise ValueError("邮件正文不能为空")
    if any(char in recipient + subject for char in "\r\n"):
        raise ValueError("邮件信息包含非法换行")

    message = EmailMessage()
    message["From"] = QQ_EMAIL
    message["To"] = recipient
    message["Subject"] = subject
    message["X-Unsent"] = "1"
    message.set_content(content)

    client = imaplib.IMAP4_SSL(QQ_IMAP_HOST, QQ_IMAP_PORT, timeout=30)
    try:
        client.login(QQ_EMAIL, QQ_EMAIL_AUTH_CODE)
        draft_box = "Drafts"
        status, folders = client.list()
        if status == "OK":
            for raw in folders or []:
                line = raw.decode("utf-8", "ignore")
                if "\\Drafts" in line:
                    match = re.search(r'"([^"]+)"\s*$', line)
                    if match:
                        draft_box = match.group(1)
                    else:
                        draft_box = line.rsplit(" ", 1)[-1].strip('"')
                    break
        status, _ = client.append(
            draft_box, "(\\Draft \\Seen)", imaplib.Time2Internaldate(time.time()),
            message.as_bytes()
        )
        if status != "OK":
            raise RuntimeError("QQ 邮箱拒绝写入草稿箱")
    finally:
        try:
            client.logout()
        except Exception:
            pass
    return {"ok": True, "message": "草稿已保存到 QQ 邮箱"}

def revise_sentence(data):
    sentence = (data.get("sentence") or "").strip()
    request = (data.get("request") or "").strip()
    if not sentence or not request:
        raise ValueError("请填写原句和修改需求")
    operation = data.get("operation")
    if operation == "explain":
        prompt = """
你是跨语言沟通解释助手。用简明中文解释用户选中文本的字面意思、语气和可能暗含的沟通效果。
只根据提供的文本解释，不猜测说话者未表达的事实或意图；指出语气判断的不确定性。
只返回中文解释，不要改写原文，不要加引号。
"""
    elif operation == "contextual_word":
        prompt = """
你是严谨的上下文编辑助手。用户提供的是包含目标词的完整句子，以及一个候选替换词。
请在该完整句子中用候选表达替换目标词，并重新检查整个句子的语法、词性、时态、数的一致、介词搭配、冠词和自然度。必要时可调整相邻词语以保证搭配正确。
保留句子原意、事实、立场、语气强度和承诺，不得只把候选词机械插入句子。
只返回修改后的完整句子，不要解释，不要加引号。
"""
    elif operation == "translate":
        prompt = """
你是准确的跨语言翻译助手。将用户提供的全文翻译成简体中文，忠实保留原意、语气、事实与承诺。
只返回中文译文，不要解释，不要加引号。
"""
    else:
        prompt = """
你是多语种沟通编辑助手。按照用户的修改要求编辑其选中的文本，并保持原语言。
改动范围必须匹配用户指定的范围：用户选中单词或短语时，只返回替换后的单词或短语；用户选中整句或段落时，返回修改后的对应整句或段落。
保留原意，不新增事实、日期、承诺或立场。只返回修改结果，不要解释，不要加引号。
"""
    revised = call_model(prompt, {"original_sentence": sentence, "revision_request": request}, stage="sentence_edit").strip()
    if not revised:
        raise RuntimeError("AI 没有返回修改结果")
    return {"ok": True, "revised_sentence": revised}


def edit_selection(data):
    before = data.get("before", "")
    selected = data.get("selection", "")
    after = data.get("after", "")
    operation = data.get("operation", "")
    tone = data.get("tone", "")
    word_original = data.get("word_original", "")
    word_replacement = data.get("word_replacement", "")
    word_request = data.get("word_request", "")
    if not all(isinstance(value, str) for value in (before, selected, after, operation, tone,
                                                     word_original, word_replacement, word_request)):
        raise ValueError("编辑内容格式不正确")
    if not selected.strip() or len(selected) > 1500 or len(before) + len(after) > 20000:
        raise ValueError("请选择不超过 1500 字的编辑片段")
    if operation not in ("rewrite", "shorten", "tone", "explain", "word"):
        raise ValueError("不支持的编辑操作")
    if operation == "tone" and tone not in ("更正式", "更随和", "更委婉", "更直接"):
        raise ValueError("请选择语气")
    if operation == "word" and (not word_original.strip() or
                                not (word_replacement.strip() or word_request.strip()) or
                                word_original not in selected or len(word_request) > 500):
        raise ValueError("请选择句中的词语并填写修改要求")

    if not API_KEY:
        if operation == "explain":
            return {"ok": True, "mode": "demo", "explanation": "Demo 示例：请结合上下文核对这段表达的字面意思与语气；离线模式无法作可靠的语用判断。"}
        alternatives = [selected]
        if operation == "word":
            replacement = word_replacement.strip()
            if word_request.strip() and not replacement:
                alternatives = [selected]
            else:
                revised = selected.replace(word_original, replacement, 1)
                # The demo handles a few common collocations, without claiming general grammar accuracy.
                if word_original.lower() == "request" and replacement.lower() == "ask":
                    revised = re.sub(r"\bask\s+(?=(?:an?|the)\b)", "ask for ", revised, count=1, flags=re.I)
                elif word_original.lower() == "discuss" and replacement.lower() == "talk":
                    revised = re.sub(r"\btalk\s+(?!about\b)(?=\w)", "talk about ", revised, count=1, flags=re.I)
                alternatives = [revised]
        elif operation == "shorten":
            concise = re.sub(r"\b(I wanted to let you know that|I would like to ask if)\s+", "", selected, flags=re.I)
            concise = re.sub(r"\b(at this point in time)\b", "now", concise, flags=re.I)
            alternatives = [concise] if concise != selected else [selected]
        elif operation in ("rewrite", "tone"):
            substitutions = (
                [(r"\bCan I\b", "Would it be possible for me to"), (r"\bHi\b", "Dear")]
                if tone in ("更正式", "更委婉") else
                [(r"\bI may not\b", "I might not"), (r"\bfinish\b", "complete")]
            )
            alternatives = [re.sub(source, target, selected, count=1, flags=re.I)
                            for source, target in substitutions]
        alternatives = list(dict.fromkeys(item for item in alternatives if item and item != selected)) or [selected]
        return {"ok": True, "mode": "demo", "alternatives": alternatives[:2]}

    prompt = """
你是跨语言沟通的局部编辑助手。只修改 selection，before 和 after 是只读上下文，不得改写或复制进候选。
保留 selection 的语言、原意、事实、立场、截止日期和承诺；constraint 是必须遵守的用户边界。
operation 为 rewrite（自然改写）、shorten（精简）、tone（按 tone 微调语气）、explain（用中文解释字面意思、语气与不确定性）或 word（修改选中句子里的指定词）。
word 操作中 selection 是包含目标词的整句，word_original 是原词，word_replacement 是候选词，word_request 是用户的额外要求。返回修改后的完整句子，且只修改该句；不能只机械替换原词。要检查词性、时态、主谓和数的一致、冠词、介词、搭配、语气及与前后句的衔接；必要时同步调整所选句内的邻词。若候选词无法保留原意，应返回原句并在解释中说明。
其他改写操作也要结合只读上下文检查句子边界处的语法搭配；无法仅在所选范围内修复的地方不要修改前后文。
任何操作都不能凭文化语境添加道歉、责任、承诺、妥协或事实。
改写时返回严格 JSON：{"alternatives":["仅替换所选片段的候选 A","仅替换所选片段的候选 B"]}。
精简时只返回一个候选；解释时返回严格 JSON：{"explanation":"中文解释"}，不要返回改写候选。
"""
    result = parse_json_loose(call_model(prompt, {
        "before": before[-1200:], "selection": selected, "after": after[:1200],
        "operation": operation, "tone": tone,
        "word_original": word_original, "word_replacement": word_replacement,
        "word_request": word_request,
        "target_context": data.get("target_context", ""),
        "constraint": data.get("constraint", "")
    }, stage="selection_edit"))
    if not isinstance(result, dict):
        raise RuntimeError("AI 返回的编辑结果格式不正确")
    if operation == "explain":
        explanation = result.get("explanation", "")
        if not isinstance(explanation, str) or not explanation.strip():
            raise RuntimeError("AI 没有返回解释")
        return {"ok": True, "mode": "ai", "explanation": explanation.strip()}
    items = result.get("alternatives", [])
    if not isinstance(items, list):
        raise RuntimeError("AI 返回的候选格式不正确")
    alternatives = list(dict.fromkeys(item.strip() for item in items
                                       if isinstance(item, str) and item.strip() and len(item) <= 3000))
    if not alternatives:
        raise RuntimeError("AI 没有返回可用的局部候选")
    return {"ok": True, "mode": "ai", "alternatives": alternatives[:2]}

def suggest_word_options(data):
    word = (data.get("word") or "").strip()
    sentence = (data.get("sentence") or "").strip()
    before = data.get("before", "")
    after = data.get("after", "")
    request = data.get("request", "")
    if not all(isinstance(value, str) for value in (word, sentence, before, after, request)):
        raise ValueError("编辑内容格式不正确")
    if not word or word not in sentence or not sentence or len(sentence) > 1500 or len(request) > 500:
        raise ValueError("请选择句中的词语并提供完整句子")
    if not API_KEY:
        return {"ok": True, "mode": "demo", "options": [],
                "warning": "未连接 AI，无法可靠校对整句语法和搭配。"}
    prompt = """
你是跨语言沟通的上下文逐词编辑助手。为选中词提供 2-5 个有区别的表达版本，一次性生成并检查每个完整句子。
sentence 是唯一可改写范围；before、after 是只读上下文，绝不能复制进候选。constraint 是硬边界。
逐个考虑词性、动词形式、主谓和数、冠词、介词、固定搭配及与前后句的衔接；必要时调整选中句中的邻词，不能机械换词。
保持原句语言、事实、立场、请求强度、道歉、责任和承诺；不能安全替换时返回空数组。
每个 option：word 是最终使用的替换词/短语，label 是其真实语气用途（如 更礼貌、更直接、更正式、更自然、更简洁），
sentence 是校对后的完整句子，explanation 用简短中文具体说明连带改变的语法/搭配；若无连带改变则明确说明原搭配仍成立，不得编造改动。
如有 request，把它作为额外语气要求。只返回严格 JSON：
{"options":[{"word":"","label":"","sentence":"","explanation":""}]}
"""
    try:
        raw = call_model(prompt, {
            "word": word, "sentence": sentence, "before": before[-1200:], "after": after[:1200],
            "request": request, "target_context": data.get("target_context", ""),
            "constraint": data.get("constraint", "")
        }, stage="word_options")
        obj = parse_json_loose(raw)
        items = obj.get("options") if isinstance(obj, dict) else None
        if not isinstance(items, list):
            raise ValueError("AI 返回的逐词候选格式不正确")
    except (URLError, HTTPError, RuntimeError) as e:
        return {"ok": True, "mode": "demo", "options": [], "warning": f"AI 候选暂不可用：{e}"}
    options = []
    seen = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        fields = {key: item.get(key, "") for key in ("word", "label", "sentence", "explanation")}
        if not all(isinstance(value, str) and value.strip() for value in fields.values()):
            continue
        revised = fields["sentence"].strip()
        if revised == sentence or len(revised) > 3000 or revised.casefold() in seen:
            continue
        options.append({key: value.strip() for key, value in fields.items()})
        seen.add(revised.casefold())
    return {"ok": True, "mode": "ai", "options": options[:5]}

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC), **kwargs)

    def do_GET(self):
        if self.path == "/api/health":
            body = json.dumps({"ok": True, "ai_configured": bool(API_KEY)}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path not in ("/api/process", "/api/extract", "/api/email/draft", "/api/revise-sentence", "/api/word-options", "/api/edit-selection"):
            self.send_error(404)
            return
        data = {}
        try:
            n = int(self.headers.get("Content-Length","0"))
            data = json.loads(self.rfile.read(n).decode("utf-8"))
            if self.path == "/api/extract":
                result = extract_info(data)
            elif self.path == "/api/email/draft":
                result = create_qq_draft(data)
            elif self.path == "/api/revise-sentence":
                result = revise_sentence(data)
            elif self.path == "/api/word-options":
                result = suggest_word_options(data)
            elif self.path == "/api/edit-selection":
                result = edit_selection(data)
            else:
                result = run_pipeline(data)
            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
        except Exception as e:
            if self.path in ("/api/email/draft", "/api/revise-sentence", "/api/word-options", "/api/edit-selection"):
                body = json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False).encode("utf-8")
                self.send_response(400)
                self.send_header("Content-Type","application/json; charset=utf-8")
                self.send_header("Content-Length",str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            warning = f"AI 接口暂不可用，已切换到 Demo 模式：{e}"
            if self.path == "/api/extract":
                result = {"ok": True, "mode": "demo", "warning": warning, "extracted": demo_extract(data)}
            else:
                result = build_demo_result(data, warning)
            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    port = int(os.getenv("PORT","8000"))
    print(f"http://localhost:{port}")
    print("AI mode" if API_KEY else "Demo mode")
    ThreadingHTTPServer(("0.0.0.0",port),Handler).serve_forever()
