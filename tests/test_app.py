import json
import unittest
from unittest.mock import patch

import app


class SelectionEditTests(unittest.TestCase):
    def test_demo_does_not_invent_a_sendable_message(self):
        result = app.build_demo_result({
            "message": "请老师改约会议，若不方便就取消", "relation": "导师 / 教授",
            "purpose": "请求 / 申请", "target_context": "美国英语语境"
        }, "AI 连接中断")
        self.assertEqual(result["mode"], "demo")
        self.assertEqual(result["candidates"]["subject"], "")
        self.assertIn("不要将此内容直接发送", result["candidates"]["polite"])
        self.assertNotIn("Monday", result["candidates"]["polite"])
        self.assertEqual(result["check"]["status"], "NEED_REVISION")

    def test_demo_edits_only_the_selected_text(self):
        with patch.object(app, "API_KEY", ""):
            result = app.edit_selection({
                "before": "Hello, ", "selection": "I may not finish on time",
                "after": ". Thank you.", "operation": "rewrite"
            })
        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "demo")
        self.assertIn("I might not finish on time", result["alternatives"])
        self.assertTrue(all("Hello" not in item and "Thank you" not in item
                            for item in result["alternatives"]))

    def test_invalid_selection_and_operation(self):
        with self.assertRaisesRegex(ValueError, "请选择"):
            app.edit_selection({"selection": " ", "operation": "rewrite"})
        with self.assertRaisesRegex(ValueError, "不支持"):
            app.edit_selection({"selection": "Hello", "operation": "delete"})
        with self.assertRaisesRegex(ValueError, "语气"):
            app.edit_selection({"selection": "Hello", "operation": "tone", "tone": "未知"})

    def test_ai_receives_context_as_read_only_fields(self):
        with patch.object(app, "API_KEY", "test"), patch.object(
            app, "call_model", return_value='{"alternatives":["Could I ask"]}'
        ) as model:
            result = app.edit_selection({
                "before": "Dear A, ", "selection": "Can I ask",
                "after": " about the deadline?", "operation": "rewrite",
                "constraint": "Do not change the deadline", "target_context": "英国英语语境"
            })
        self.assertEqual(result["alternatives"], ["Could I ask"])
        payload = model.call_args.args[1]
        self.assertEqual(payload["before"], "Dear A, ")
        self.assertEqual(payload["selection"], "Can I ask")
        self.assertEqual(payload["after"], " about the deadline?")
        self.assertEqual(payload["constraint"], "Do not change the deadline")

    def test_word_edit_sends_sentence_and_read_only_context(self):
        with patch.object(app, "API_KEY", "test"), patch.object(
            app, "call_model", return_value='{"alternatives":["I would like to talk about the plan."]}'
        ) as model:
            result = app.edit_selection({
                "before": "Dear Taylor, ",
                "selection": "I would like to discuss the plan.",
                "after": " Thank you.",
                "operation": "word", "word_original": "discuss",
                "word_replacement": "talk",
                "constraint": "Do not change the request",
            })
        self.assertEqual(result["alternatives"], ["I would like to talk about the plan."])
        prompt, payload = model.call_args.args[:2]
        self.assertIn("主谓", prompt)
        self.assertIn("介词", prompt)
        self.assertEqual(payload["before"], "Dear Taylor, ")
        self.assertEqual(payload["after"], " Thank you.")
        self.assertEqual(payload["word_original"], "discuss")
        self.assertEqual(payload["word_replacement"], "talk")

    def test_demo_word_edit_corrects_supported_collocation(self):
        with patch.object(app, "API_KEY", ""):
            result = app.edit_selection({
                "before": "Hello, ", "selection": "I discuss the plan.",
                "after": " Thank you.", "operation": "word",
                "word_original": "discuss", "word_replacement": "talk"
            })
        self.assertEqual(result["alternatives"], ["I talk about the plan."])
        self.assertNotIn("Hello", result["alternatives"][0])

    def test_word_edit_rejects_missing_or_unrelated_word(self):
        with self.assertRaisesRegex(ValueError, "词语"):
            app.edit_selection({"operation":"word","selection":"Discuss the plan.",
                                "word_original":"meeting","word_replacement":"talk"})


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.data = {"message": "请老师改约会议", "relation": "导师 / 教授",
                     "purpose": "请求 / 申请", "target_context": "美国英语语境",
                     "style_controls": {"directness": 3, "politeness": 4, "formality": 4},
                     "culture_overrides": {"directness": 5},
                     "contact_memory": {"terms": ["Project Aurora"],
                                        "recent_history": [{"purpose": "确认时间", "at": 1}]}}
        self.result = {
            "intent": {"fact": "请老师改约会议", "goal": "改约", "stance": "询问"},
            "context": {"relationship": {"evidence": "导师"}, "speech_act": {"evidence": "改约"}},
            "culture": {"target_context": "美国英语语境", "profile": {
                key: "moderate" for key in ("directness", "mitigation", "apology", "explanation",
                    "responsibility", "commitment", "hierarchy", "relational_warmth")}},
            "candidates": {"subject": "Meeting", "source_translation": "Please reschedule the meeting.",
                           "direct": "Can we reschedule?", "direct_translation": "能改约吗？",
                           "polite": "Could we reschedule?", "polite_translation": "可以改约吗？",
                           "concise": "Reschedule?", "concise_translation": "改约吗？"},
            "check": {"status": "PASS", "flags": [], "explanation": "生成时自检"}
        }

    def test_generation_uses_one_model_call_and_keeps_contract(self):
        with patch.object(app, "API_KEY", "test"), patch.object(
            app, "call_model", return_value=json.dumps(self.result, ensure_ascii=False)
        ) as model:
            result = app.run_pipeline(self.data)
        self.assertEqual(model.call_count, 1)
        self.assertEqual(model.call_args.kwargs["stage"], "communication")
        self.assertEqual(model.call_args.args[1]["culture_overrides"]["directness"], 5)
        self.assertEqual(model.call_args.args[1]["contact_memory"]["terms"], ["Project Aurora"])
        self.assertIn("专属词汇", model.call_args.args[0])
        self.assertEqual(result["mode"], "ai")
        self.assertEqual(result["candidates"]["source_translation"], "Please reschedule the meeting.")

    def test_incomplete_generation_is_not_reported_as_ai_success(self):
        self.result["candidates"].pop("polite_translation")
        with patch.object(app, "API_KEY", "test"), patch.object(
            app, "call_model", return_value=json.dumps(self.result, ensure_ascii=False)
        ), self.assertRaisesRegex(RuntimeError, "译文不完整"):
            app.run_pipeline(self.data)


class WordOptionTests(unittest.TestCase):
    def test_options_include_revised_sentence_and_grammar_note(self):
        option = {"word": "talk", "label": "更随和", "sentence": "I would like to talk about the plan.",
                  "explanation": "talk 后需加 about。"}
        with patch.object(app, "API_KEY", "test"), patch.object(
            app, "call_model", return_value=json.dumps({"options": [option]}, ensure_ascii=False)
        ) as model:
            result = app.suggest_word_options({
                "word": "discuss", "sentence": "I would like to discuss the plan.",
                "before": "Dear Taylor. ", "after": " Thank you.", "constraint": "不要增加承诺"
            })
        self.assertEqual(result["options"], [option])
        payload = model.call_args.args[1]
        self.assertEqual(payload["before"], "Dear Taylor. ")
        self.assertEqual(payload["after"], " Thank you.")
        self.assertIn("介词", model.call_args.args[0])

    def test_incomplete_or_demo_options_are_not_offered(self):
        data = {"word": "discuss", "sentence": "I discuss the plan."}
        with patch.object(app, "API_KEY", "test"), patch.object(
            app, "call_model", return_value='{"options":[{"word":"talk","sentence":"I talk about the plan."}]}'
        ):
            self.assertEqual(app.suggest_word_options(data)["options"], [])
        with patch.object(app, "API_KEY", ""):
            result = app.suggest_word_options(data)
        self.assertEqual(result["mode"], "demo")
        self.assertEqual(result["options"], [])


if __name__ == "__main__":
    unittest.main()
