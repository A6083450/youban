import unittest

from app.agents.stream_json import stream_extract_string_field


class StreamExtractStringFieldTest(unittest.TestCase):
    def test_complete_value_is_closed(self):
        val, closed = stream_extract_string_field(
            '{"action":"chat","reply":"你好世界"}', "reply"
        )
        self.assertEqual(val, "你好世界")
        self.assertTrue(closed)

    def test_unclosed_value_not_closed(self):
        val, closed = stream_extract_string_field('{"reply":"你好', "reply")
        self.assertEqual(val, "你好")
        self.assertFalse(closed)

    def test_escaped_quote(self):
        val, closed = stream_extract_string_field(
            '{"reply":"他说\\"嗨\\""}', "reply"
        )
        self.assertEqual(val, '他说"嗨"')
        self.assertTrue(closed)

    def test_newline_escape(self):
        val, closed = stream_extract_string_field(
            '{"reply":"第一行\\n第二行"}', "reply"
        )
        self.assertEqual(val, "第一行\n第二行")
        self.assertTrue(closed)

    def test_dangling_backslash_not_emitted(self):
        # 末尾单独一个反斜杠：转义未完成，不能吐出半个转义
        val, closed = stream_extract_string_field('{"reply":"a\\', "reply")
        self.assertEqual(val, "a")
        self.assertFalse(closed)

    def test_unicode_escape(self):
        val, closed = stream_extract_string_field(
            '{"reply":"\\u4f60\\u597d"}', "reply"
        )
        self.assertEqual(val, "你好")
        self.assertTrue(closed)

    def test_partial_unicode_escape_waits(self):
        # \u4f6 只有 3 位十六进制，未到齐时前面的字符照常输出、半个 \u 不输出
        val, closed = stream_extract_string_field('{"reply":"a\\u4f6', "reply")
        self.assertEqual(val, "a")
        self.assertFalse(closed)

    def test_field_positioned_late(self):
        val, closed = stream_extract_string_field(
            '{"action":"plan","emotion":"neutral","summary":"x","reply":"末尾"}',
            "reply",
        )
        self.assertEqual(val, "末尾")
        self.assertTrue(closed)

    def test_field_absent(self):
        val, closed = stream_extract_string_field('{"action":"chat"', "reply")
        self.assertEqual(val, "")
        self.assertFalse(closed)

    def test_open_quote_not_arrived(self):
        # key 出现了但值的开引号还没到
        val, closed = stream_extract_string_field('{"reply":  ', "reply")
        self.assertEqual(val, "")
        self.assertFalse(closed)

    def test_message_field_for_confirm(self):
        val, closed = stream_extract_string_field(
            '{"action":"confirm","confidence":0.9,"message":"这就帮你生成"}',
            "message",
        )
        self.assertEqual(val, "这就帮你生成")
        self.assertTrue(closed)

    def test_empty_inputs(self):
        self.assertEqual(stream_extract_string_field("", "reply"), ("", False))
        self.assertEqual(stream_extract_string_field("{}", ""), ("", False))

    def test_incremental_feed_is_monotonic(self):
        # 逐字符喂入：每一步的值都必须是上一步值的前缀扩展，最终等于真实值
        full = '{"action":"chat","emotion":"excited","reply":"你好\\n世界\\"引用\\"结束","follow_up_question":""}'
        expected = '你好\n世界"引用"结束'
        prev = ""
        final_val, final_closed = "", False
        for k in range(1, len(full) + 1):
            val, closed = stream_extract_string_field(full[:k], "reply")
            self.assertTrue(
                val.startswith(prev),
                msg=f"非单调: 上一步={prev!r} 这一步={val!r} @k={k}",
            )
            prev = val
            final_val, final_closed = val, closed
        self.assertEqual(final_val, expected)
        self.assertTrue(final_closed)


if __name__ == "__main__":
    unittest.main()
