# Python 243-Test Disposition

> 由 `bun run scripts/generate-python-test-disposition.ts` 生成。不要手工编辑。

基线：243/243 已处置；`port=122`，`replace=105`，`retire=16`。

- `port`：业务行为与契约直接迁入 TypeScript 测试。
- `replace`：旧实现被新架构替代，等价风险由所列 TS 测试承担。
- `retire`：能力按已确认决策删除；必须给出删除理由。

| # | Python case | 处置 | TS 证据 | 理由 |
|---:|---|---|---|---|
| 1 | `app/agents/langgraph_planner_test.py:195::test_completed_search_checkpoint_skips_all_research_agents` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 2 | `app/agents/langgraph_planner_test.py:211::test_segments_run_concurrently_and_merge_stably` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 3 | `app/agents/langgraph_planner_test.py:219::test_duplicate_attraction_repairs_only_later_segment` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 4 | `app/agents/langgraph_planner_test.py:246::test_segment_failure_saves_other_results_and_snapshots` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 5 | `app/agents/langgraph_planner_test.py:267::test_resume_only_runs_failed_segment` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 6 | `app/agents/langgraph_planner_test.py:282::test_generated_segment_with_wrong_city_is_failed` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 7 | `app/agents/langgraph_planner_test.py:294::test_completed_segment_with_wrong_date_is_regenerated` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 8 | `app/agents/langgraph_planner_test.py:309::test_memory_context_is_injected_into_segment_prompt` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 9 | `app/agents/langgraph_planner_test.py:315::test_english_request_prompts_and_fallback_use_english` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 10 | `app/agents/langgraph_planner_test.py:326::test_unsupported_persisted_locale_falls_back_to_chinese` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 11 | `app/agents/langgraph_planner_test.py:333::test_summary_failure_uses_deterministic_fallback` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 12 | `app/agents/langgraph_planner_test.py:346::test_review_failure_still_yields_plan` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 13 | `app/agents/langgraph_planner_test.py:358::test_review_prompt_contains_segment_mapping` | `retire` | - | LangGraph callback/revision-loop implementation no longer exists |
| 14 | `app/agents/langgraph_planner_test.py:368::test_review_revises_only_selected_segment_once` | `retire` | - | LangGraph callback/revision-loop implementation no longer exists |
| 15 | `app/agents/langgraph_planner_test.py:377::test_resume_after_failed_revision_does_not_review_again` | `retire` | - | LangGraph callback/revision-loop implementation no longer exists |
| 16 | `app/agents/langgraph_planner_test.py:399::test_completed_summary_and_review_checkpoint_are_reused` | `replace` | tests/pi-trip-planner.test.ts, tests/orchestrator.test.ts | 有业务价值的并发、恢复、校验或降级语义由无图 Pi 编排器覆盖 |
| 17 | `app/agents/langgraph_planner_test.py:415::test_regenerated_segment_invalidates_completed_summary_and_review` | `retire` | - | LangGraph callback/revision-loop implementation no longer exists |
| 18 | `app/agents/langgraph_planner_test.py:436::test_invalid_completed_summary_and_review_are_regenerated` | `retire` | - | LangGraph callback/revision-loop implementation no longer exists |
| 19 | `app/agents/langgraph_planner_test.py:455::test_multiple_segment_revision_progress_never_decreases` | `retire` | - | LangGraph callback/revision-loop implementation no longer exists |
| 20 | `app/agents/langgraph_planner_test.py:462::test_future_returned_by_checkpoint_callback_is_awaited` | `retire` | - | LangGraph callback/revision-loop implementation no longer exists |
| 21 | `app/agents/langgraph_planner_test.py:474::test_generic_checkpoint_callback_failure_is_not_retried` | `retire` | - | LangGraph callback/revision-loop implementation no longer exists |
| 22 | `app/agents/langgraph_planner_test.py:493::test_checkpoint_callback_failure_propagates` | `retire` | - | LangGraph callback/revision-loop implementation no longer exists |
| 23 | `app/agents/plan_parser_test.py:30::test_parse_valid_fenced_json` | `port` | tests/plan-parser.test.ts | JSON 修复链由 TS 纯函数逐类覆盖 |
| 24 | `app/agents/plan_parser_test.py:35::test_sanitize_strips_arithmetic_expressions` | `port` | tests/plan-parser.test.ts | JSON 修复链由 TS 纯函数逐类覆盖 |
| 25 | `app/agents/plan_parser_test.py:39::test_remove_trailing_commas` | `port` | tests/plan-parser.test.ts | JSON 修复链由 TS 纯函数逐类覆盖 |
| 26 | `app/agents/plan_parser_test.py:42::test_fix_unescaped_quotes` | `port` | tests/plan-parser.test.ts | JSON 修复链由 TS 纯函数逐类覆盖 |
| 27 | `app/agents/plan_parser_test.py:46::test_repair_truncated_json` | `port` | tests/plan-parser.test.ts | JSON 修复链由 TS 纯函数逐类覆盖 |
| 28 | `app/agents/plan_parser_test.py:51::test_unparseable_raises_value_error` | `port` | tests/plan-parser.test.ts | JSON 修复链由 TS 纯函数逐类覆盖 |
| 29 | `app/agents/stream_json_test.py:7::test_complete_value_is_closed` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 30 | `app/agents/stream_json_test.py:14::test_unclosed_value_not_closed` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 31 | `app/agents/stream_json_test.py:19::test_escaped_quote` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 32 | `app/agents/stream_json_test.py:26::test_newline_escape` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 33 | `app/agents/stream_json_test.py:33::test_dangling_backslash_not_emitted` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 34 | `app/agents/stream_json_test.py:39::test_unicode_escape` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 35 | `app/agents/stream_json_test.py:46::test_partial_unicode_escape_waits` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 36 | `app/agents/stream_json_test.py:52::test_field_positioned_late` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 37 | `app/agents/stream_json_test.py:60::test_field_absent` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 38 | `app/agents/stream_json_test.py:65::test_open_quote_not_arrived` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 39 | `app/agents/stream_json_test.py:71::test_message_field_for_confirm` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 40 | `app/agents/stream_json_test.py:79::test_empty_inputs` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 41 | `app/agents/stream_json_test.py:83::test_incremental_feed_is_monotonic` | `port` | tests/stream-json.test.ts | 增量字符串提取由 TS 前缀单调性测试覆盖 |
| 42 | `app/agents/trip_parallel_research_test.py:41::test_hotel_search_uses_each_city_overnight_date_range` | `replace` | tests/pi-trip-planner.test.ts | 研究预取与分段并发由确定性 Pi 编排器覆盖 |
| 43 | `app/agents/trip_parallel_research_test.py:54::test_first_multi_city_wave_contains_every_research_category` | `replace` | tests/pi-trip-planner.test.ts | 研究预取与分段并发由确定性 Pi 编排器覆盖 |
| 44 | `app/agents/trip_parallel_research_test.py:91::test_duplicate_city_is_queried_once_with_monotonic_progress` | `replace` | tests/pi-trip-planner.test.ts | 研究预取与分段并发由确定性 Pi 编排器覆盖 |
| 45 | `app/agents/trip_parallel_research_test.py:119::test_research_agents_run_together_before_main_agent_aggregation` | `replace` | tests/pi-trip-planner.test.ts | 研究预取与分段并发由确定性 Pi 编排器覆盖 |
| 46 | `app/agents/trip_plan_orchestrator_test.py:112::test_single_city_sizes` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 47 | `app/agents/trip_plan_orchestrator_test.py:119::test_every_day_is_covered_once` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 48 | `app/agents/trip_plan_orchestrator_test.py:124::test_city_boundary_is_preserved_when_possible` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 49 | `app/agents/trip_plan_orchestrator_test.py:130::test_rejects_city_days_not_equal_to_travel_days` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 50 | `app/agents/trip_plan_orchestrator_test.py:137::test_attraction_candidates_are_disjoint_across_parallel_segments` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 51 | `app/agents/trip_plan_orchestrator_test.py:159::test_unknown_or_invalid_checkpoint_falls_back` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 52 | `app/agents/trip_plan_orchestrator_test.py:163::test_valid_checkpoint_is_copied` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 53 | `app/agents/trip_plan_orchestrator_test.py:177::test_processing_segment_resumes_as_pending` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 54 | `app/agents/trip_plan_orchestrator_test.py:205::test_invalid_nested_checkpoint_falls_back` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 55 | `app/agents/trip_plan_orchestrator_test.py:241::test_parse_attraction_candidates_reads_structured_lines` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 56 | `app/agents/trip_plan_orchestrator_test.py:247::test_verified_attraction_overwrites_agent_identity_fields` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 57 | `app/agents/trip_plan_orchestrator_test.py:271::test_rejects_unknown_attraction_id_when_candidates_exist` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 58 | `app/agents/trip_plan_orchestrator_test.py:282::test_parse_valid_segment` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 59 | `app/agents/trip_plan_orchestrator_test.py:293::test_parse_tolerates_fenced_json_and_trailing_comma` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 60 | `app/agents/trip_plan_orchestrator_test.py:299::test_rejects_missing_or_extra_day` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 61 | `app/agents/trip_plan_orchestrator_test.py:307::test_rejects_wrong_segment_id` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 62 | `app/agents/trip_plan_orchestrator_test.py:315::test_rejects_multiple_top_level_json_values` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 63 | `app/agents/trip_plan_orchestrator_test.py:323::test_rejects_unknown_segment_field` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 64 | `app/agents/trip_plan_orchestrator_test.py:328::test_rejects_repaired_object_followed_by_another_json_value` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 65 | `app/agents/trip_plan_orchestrator_test.py:334::test_rejects_non_object_top_level_with_value_error` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 66 | `app/agents/trip_plan_orchestrator_test.py:338::test_rejects_agent_generated_hotel_object` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 67 | `app/agents/trip_plan_orchestrator_test.py:346::test_rejects_unknown_hotel_id` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 68 | `app/agents/trip_plan_orchestrator_test.py:356::test_allows_null_hotel_only_when_no_verified_candidates_exist` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 69 | `app/agents/trip_plan_orchestrator_test.py:365::test_uses_first_verified_candidate_when_agent_omits_hotel_id` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 70 | `app/agents/trip_plan_orchestrator_test.py:377::test_last_travel_day_never_adds_an_extra_hotel_night` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 71 | `app/agents/trip_plan_orchestrator_test.py:400::test_merge_completed_segments_in_day_order` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 72 | `app/agents/trip_plan_orchestrator_test.py:410::test_merge_rejects_duplicate_missing_and_wrong_date` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 73 | `app/agents/trip_plan_orchestrator_test.py:421::test_merge_rejects_wrong_city` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 74 | `app/agents/trip_plan_orchestrator_test.py:427::test_merge_rejects_unknown_completed_segment` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 75 | `app/agents/trip_plan_orchestrator_test.py:437::test_merge_rejects_cross_segment_output` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 76 | `app/agents/trip_plan_orchestrator_test.py:447::test_duplicate_poi_marks_only_later_segment_for_repair` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 77 | `app/agents/trip_plan_orchestrator_test.py:463::test_same_name_with_different_poi_ids_is_not_a_duplicate` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 78 | `app/agents/trip_plan_orchestrator_test.py:471::test_legacy_attractions_without_poi_ids_fall_back_to_name` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 79 | `app/agents/trip_plan_orchestrator_test.py:478::test_budget_sums_only_modeled_cost_fields` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 80 | `app/agents/trip_plan_orchestrator_test.py:490::test_build_weather_skips_invalid_out_of_range_and_duplicates` | `port` | tests/orchestrator.test.ts, tests/pi-trip-planner.test.ts | 分段、候选池、checkpoint、合并、去重、预算和天气语义已迁移 |
| 81 | `app/agents/trip_responses_content_test.py:21::test_extracts_final_text_from_responses_api_content_blocks` | `replace` | tests/pi-llm-client.test.ts | 旧 Responses 内容块解析由 pi-ai 流式适配层替代 |
| 82 | `app/api/routes/admin_trips_endpoint_test.py:64::test_requires_admin_token` | `port` | tests/admin-http.test.ts | 管理鉴权和跨用户列表 HTTP 契约已迁移 |
| 83 | `app/api/routes/admin_trips_endpoint_test.py:68::test_returns_all_users_trips_with_nicknames` | `port` | tests/admin-http.test.ts | 管理鉴权和跨用户列表 HTTP 契约已迁移 |
| 84 | `app/api/routes/auth_endpoint_test.py:28::test_login_success` | `port` | tests/http-contract.test.ts | 登录、身份复用和校验 HTTP 契约已迁移 |
| 85 | `app/api/routes/auth_endpoint_test.py:36::test_login_same_nickname_same_user` | `port` | tests/http-contract.test.ts | 登录、身份复用和校验 HTTP 契约已迁移 |
| 86 | `app/api/routes/auth_endpoint_test.py:41::test_login_invalid_nickname` | `port` | tests/http-contract.test.ts | 登录、身份复用和校验 HTTP 契约已迁移 |
| 87 | `app/api/routes/auth_endpoint_test.py:45::test_me_roundtrip` | `port` | tests/http-contract.test.ts | 登录、身份复用和校验 HTTP 契约已迁移 |
| 88 | `app/api/routes/trip_attractions_endpoint_test.py:77::test_create_real_poi_updates_plan_and_budget_together` | `port` | tests/trip-attractions-http.test.ts | 可信 POI 行程项 CRUD 与联动更新已迁移 |
| 89 | `app/api/routes/trip_attractions_endpoint_test.py:97::test_update_moves_attraction_and_rebuilds_ticket_row` | `port` | tests/trip-attractions-http.test.ts | 可信 POI 行程项 CRUD 与联动更新已迁移 |
| 90 | `app/api/routes/trip_attractions_endpoint_test.py:136::test_delete_removes_attraction_execution_and_budget_row` | `port` | tests/trip-attractions-http.test.ts | 可信 POI 行程项 CRUD 与联动更新已迁移 |
| 91 | `app/api/routes/trip_attractions_endpoint_test.py:152::test_allows_same_poi_on_different_days_but_rejects_same_day_duplicate` | `port` | tests/trip-attractions-http.test.ts | 可信 POI 行程项 CRUD 与联动更新已迁移 |
| 92 | `app/api/routes/trip_attractions_endpoint_test.py:161::test_rejects_unverified_poi` | `port` | tests/trip-attractions-http.test.ts | 可信 POI 行程项 CRUD 与联动更新已迁移 |
| 93 | `app/api/routes/trip_attractions_endpoint_test.py:167::test_rejects_invalid_time_and_non_owner` | `port` | tests/trip-attractions-http.test.ts | 可信 POI 行程项 CRUD 与联动更新已迁移 |
| 94 | `app/api/routes/trip_budget_items_endpoint_test.py:98::test_get_derives_all_rows_and_keeps_unpriced_hotel` | `port` | tests/budget-http.test.ts, tests/budget-guard.test.ts | 预算明细、口径、缓冲和权限契约已迁移 |
| 95 | `app/api/routes/trip_budget_items_endpoint_test.py:108::test_group_and_per_person_totals_use_rooms_nights_and_travelers` | `port` | tests/budget-http.test.ts, tests/budget-guard.test.ts | 预算明细、口径、缓冲和权限契约已迁移 |
| 96 | `app/api/routes/trip_budget_items_endpoint_test.py:147::test_budget_status_reports_overage_and_separate_pending_buffer` | `port` | tests/budget-http.test.ts, tests/budget-guard.test.ts | 预算明细、口径、缓冲和权限契约已迁移 |
| 97 | `app/api/routes/trip_budget_items_endpoint_test.py:167::test_edit_hotel_price_updates_totals_and_survives_reload` | `port` | tests/budget-http.test.ts, tests/budget-guard.test.ts | 预算明细、口径、缓冲和权限契约已迁移 |
| 98 | `app/api/routes/trip_budget_items_endpoint_test.py:186::test_create_update_delete_and_restore_diy_item` | `port` | tests/budget-http.test.ts, tests/budget-guard.test.ts | 预算明细、口径、缓冲和权限契约已迁移 |
| 99 | `app/api/routes/trip_budget_items_endpoint_test.py:217::test_itinerary_attraction_rejects_budget_only_override` | `port` | tests/budget-http.test.ts, tests/budget-guard.test.ts | 预算明细、口径、缓冲和权限契约已迁移 |
| 100 | `app/api/routes/trip_budget_items_endpoint_test.py:230::test_rejects_invalid_day_and_non_owner` | `port` | tests/budget-http.test.ts, tests/budget-guard.test.ts | 预算明细、口径、缓冲和权限契约已迁移 |
| 101 | `app/api/routes/trip_confirmation_endpoint_test.py:84::test_plan_rejects_missing_token_before_creating_task` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 102 | `app/api/routes/trip_confirmation_endpoint_test.py:95::test_plan_rejects_forged_token_before_creating_task` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 103 | `app/api/routes/trip_confirmation_endpoint_test.py:106::test_plan_rejects_token_when_any_authorized_semantic_was_mutated` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 104 | `app/api/routes/trip_confirmation_endpoint_test.py:128::test_plan_returns_401_for_expired_token_without_side_effects` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 105 | `app/api/routes/trip_confirmation_endpoint_test.py:143::test_normalized_parse_draft_authorizes_identical_plan_request_once` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 106 | `app/api/routes/trip_confirmation_endpoint_test.py:181::test_plan_accepts_integer_budget_token_after_float_model_normalization` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 107 | `app/api/routes/trip_confirmation_endpoint_test.py:200::test_plan_accepts_valid_token_once` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 108 | `app/api/routes/trip_confirmation_endpoint_test.py:213::test_plan_rejects_second_use_of_same_token_without_new_task` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 109 | `app/api/routes/trip_confirmation_endpoint_test.py:271::test_high_confidence_confirm_signs_decision` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 110 | `app/api/routes/trip_confirmation_endpoint_test.py:287::test_confirm_uses_current_draft_for_response_and_authorization` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 111 | `app/api/routes/trip_confirmation_endpoint_test.py:305::test_low_confidence_confirm_downgrades_to_ask_confirmation` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 112 | `app/api/routes/trip_confirmation_endpoint_test.py:320::test_non_number_confidence_fails_closed` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 113 | `app/api/routes/trip_confirmation_endpoint_test.py:337::test_chat_preserves_draft_and_never_signs` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 114 | `app/api/routes/trip_confirmation_endpoint_test.py:351::test_update_returns_full_trip_without_signing` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 115 | `app/api/routes/trip_confirmation_endpoint_test.py:380::test_update_recalculates_end_date_when_new_duration_omits_it` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 116 | `app/api/routes/trip_confirmation_endpoint_test.py:400::test_update_explicit_empty_lists_clear_existing_values` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 117 | `app/api/routes/trip_confirmation_endpoint_test.py:430::test_update_invalid_list_types_safely_fall_back_to_existing_values` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 118 | `app/api/routes/trip_confirmation_endpoint_test.py:460::test_unsupported_persisted_locale_falls_back_to_chinese` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 119 | `app/api/routes/trip_confirmation_endpoint_test.py:476::test_cancel_preserves_draft_and_never_signs` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 120 | `app/api/routes/trip_confirmation_endpoint_test.py:489::test_model_ask_confirmation_never_signs` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 121 | `app/api/routes/trip_confirmation_endpoint_test.py:502::test_llm_json_error_asks_confirmation_without_signing` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 122 | `app/api/routes/trip_confirmation_endpoint_test.py:512::test_llm_non_object_json_asks_confirmation_without_signing` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 123 | `app/api/routes/trip_confirmation_endpoint_test.py:524::test_contextual_confirmation_scenario_matrix` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 124 | `app/api/routes/trip_confirmation_endpoint_test.py:636::test_non_finite_confirm_confidence_fails_closed` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 125 | `app/api/routes/trip_confirmation_endpoint_test.py:654::test_invalid_action_fails_closed_to_ask_confirmation` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 126 | `app/api/routes/trip_confirmation_endpoint_test.py:669::test_parse_normalizes_conflicting_valid_end_date` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 127 | `app/api/routes/trip_confirmation_endpoint_test.py:692::test_parse_route_never_signs` | `replace` | tests/trip-assistant-http.test.ts, tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 确认判断、签名与一次性执行被拆到智能体、账本和计划端点测试 |
| 128 | `app/api/routes/trip_conversation_endpoint_test.py:55::test_plan_persists_the_full_creation_conversation` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 129 | `app/api/routes/trip_conversation_endpoint_test.py:70::test_get_conversation_returns_saved_messages_for_the_plan` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 130 | `app/api/routes/trip_conversation_endpoint_test.py:89::test_conversation_rejects_a_different_user` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 131 | `app/api/routes/trip_conversation_endpoint_test.py:101::test_conversation_allows_an_authenticated_admin_to_read_an_owned_plan` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 132 | `app/api/routes/trip_conversation_endpoint_test.py:128::test_conversation_keeps_legacy_unowned_tasks_readable` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 133 | `app/api/routes/trip_conversation_endpoint_test.py:140::test_task_owner_helper_rejects_other_users_and_allows_legacy_tasks` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 134 | `app/api/routes/trip_conversation_endpoint_test.py:151::test_delete_rejects_a_different_user` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 135 | `app/api/routes/trip_conversation_endpoint_test.py:165::test_status_rejects_a_different_user` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 136 | `app/api/routes/trip_conversation_endpoint_test.py:179::test_share_rejects_an_unpublished_task_id` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 137 | `app/api/routes/trip_conversation_endpoint_test.py:194::test_share_returns_only_a_completed_plan_for_its_share_token` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 138 | `app/api/routes/trip_conversation_endpoint_test.py:217::test_owner_can_create_share_token_for_a_completed_plan` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 139 | `app/api/routes/trip_conversation_endpoint_test.py:237::test_share_creation_rejects_a_different_user` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 140 | `app/api/routes/trip_conversation_endpoint_test.py:252::test_share_creation_rejects_a_plan_that_is_not_completed` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 141 | `app/api/routes/trip_conversation_endpoint_test.py:265::test_share_creation_reuses_the_persisted_token` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 142 | `app/api/routes/trip_conversation_endpoint_test.py:285::test_share_token_survives_task_persistence` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 143 | `app/api/routes/trip_conversation_endpoint_test.py:304::test_share_rejects_a_plan_that_is_not_completed` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 144 | `app/api/routes/trip_conversation_endpoint_test.py:318::test_status_keeps_legacy_unowned_tasks_readable` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 145 | `app/api/routes/trip_conversation_endpoint_test.py:331::test_status_allows_an_authenticated_admin_to_read_an_owned_plan` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 146 | `app/api/routes/trip_conversation_endpoint_test.py:351::test_status_rejects_an_invalid_admin_token_for_an_owned_plan` | `replace` | tests/conversation-http.test.ts, tests/trip-task-mutations-http.test.ts, tests/http-contract.test.ts | 会话、分享、所有权和历史读取按 TS 路由边界重组 |
| 147 | `app/api/routes/trip_history_filter_test.py:22::test_item_carries_user_id` | `port` | tests/http-contract.test.ts, tests/task-store.test.ts | 用户历史隔离和旧任务兼容已迁移 |
| 148 | `app/api/routes/trip_history_filter_test.py:26::test_item_legacy_task_user_id_empty` | `port` | tests/http-contract.test.ts, tests/task-store.test.ts | 用户历史隔离和旧任务兼容已迁移 |
| 149 | `app/api/routes/trip_item_ids_test.py:45::test_new_item_id_format` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 150 | `app/api/routes/trip_item_ids_test.py:50::test_inject_ids_into_dict_result` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 151 | `app/api/routes/trip_item_ids_test.py:58::test_idempotent` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 152 | `app/api/routes/trip_item_ids_test.py:65::test_inject_ids_into_model_result` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 153 | `app/api/routes/trip_item_ids_test.py:70::test_none_and_empty` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 154 | `app/api/routes/trip_item_ids_test.py:74::test_find_plan_item` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 155 | `app/api/routes/trip_item_ids_test.py:115::test_new_task_has_empty_checkpoint` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 156 | `app/api/routes/trip_item_ids_test.py:118::test_checkpoint_round_trips_through_task_json` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 157 | `app/api/routes/trip_item_ids_test.py:131::test_restart_marks_processing_failed_without_losing_checkpoint` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 158 | `app/api/routes/trip_item_ids_test.py:145::test_task_event_exposes_summary_but_not_full_checkpoint` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 159 | `app/api/routes/trip_item_ids_test.py:165::test_failed_status_exposes_summary_but_not_full_checkpoint` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 160 | `app/api/routes/trip_item_ids_test.py:175::test_regular_state_update_broadcasts_when_persistence_fails` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 161 | `app/api/routes/trip_item_ids_test.py:194::test_checkpoint_persistence_failure_reaches_callback` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 162 | `app/api/routes/trip_item_ids_test.py:208::test_checkpoint_callback_rejects_missing_task` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 163 | `app/api/routes/trip_item_ids_test.py:212::test_run_planning_passes_saved_checkpoint_and_callback` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 164 | `app/api/routes/trip_item_ids_test.py:265::test_preload_writes_ids_back_and_stable_across_restart` | `replace` | tests/trip-attractions-http.test.ts, tests/task-store.test.ts, tests/ws-contract.test.ts | 稳定行程项 ID、checkpoint 持久化和事件投影由对应 TS 模块覆盖 |
| 165 | `app/api/routes/trip_item_status_endpoint_test.py:77::test_done_with_cost` | `port` | tests/trip-task-mutations-http.test.ts | 执行状态、所有权和持久化在统一 mutation 端点测试覆盖 |
| 166 | `app/api/routes/trip_item_status_endpoint_test.py:85::test_status_response_carries_execution` | `port` | tests/trip-task-mutations-http.test.ts | 执行状态、所有权和持久化在统一 mutation 端点测试覆盖 |
| 167 | `app/api/routes/trip_item_status_endpoint_test.py:90::test_pending_removes_entry` | `port` | tests/trip-task-mutations-http.test.ts | 执行状态、所有权和持久化在统一 mutation 端点测试覆盖 |
| 168 | `app/api/routes/trip_item_status_endpoint_test.py:98::test_non_owner_403` | `port` | tests/trip-task-mutations-http.test.ts | 执行状态、所有权和持久化在统一 mutation 端点测试覆盖 |
| 169 | `app/api/routes/trip_item_status_endpoint_test.py:102::test_unknown_item_404` | `port` | tests/trip-task-mutations-http.test.ts | 执行状态、所有权和持久化在统一 mutation 端点测试覆盖 |
| 170 | `app/api/routes/trip_item_status_endpoint_test.py:106::test_unknown_plan_404` | `port` | tests/trip-task-mutations-http.test.ts | 执行状态、所有权和持久化在统一 mutation 端点测试覆盖 |
| 171 | `app/api/routes/trip_item_status_endpoint_test.py:114::test_processing_409` | `port` | tests/trip-task-mutations-http.test.ts | 执行状态、所有权和持久化在统一 mutation 端点测试覆盖 |
| 172 | `app/api/routes/trip_item_status_endpoint_test.py:119::test_invalid_status_422` | `port` | tests/trip-task-mutations-http.test.ts | 执行状态、所有权和持久化在统一 mutation 端点测试覆盖 |
| 173 | `app/api/routes/trip_item_status_endpoint_test.py:123::test_execution_survives_reload` | `port` | tests/trip-task-mutations-http.test.ts | 执行状态、所有权和持久化在统一 mutation 端点测试覆盖 |
| 174 | `app/api/routes/trip_retry_endpoint_test.py:53::test_reuses_task_and_clears_execution_token` | `port` | tests/trip-planning-http.test.ts, tests/task-store.test.ts | 同 task_id 重试、状态限制和 checkpoint 恢复已迁移 |
| 175 | `app/api/routes/trip_retry_endpoint_test.py:96::test_restart_all_clears_checkpoint` | `port` | tests/trip-planning-http.test.ts, tests/task-store.test.ts | 同 task_id 重试、状态限制和 checkpoint 恢复已迁移 |
| 176 | `app/api/routes/trip_retry_endpoint_test.py:104::test_missing_is_404` | `port` | tests/trip-planning-http.test.ts, tests/task-store.test.ts | 同 task_id 重试、状态限制和 checkpoint 恢复已迁移 |
| 177 | `app/api/routes/trip_retry_endpoint_test.py:110::test_non_owner_is_403` | `port` | tests/trip-planning-http.test.ts, tests/task-store.test.ts | 同 task_id 重试、状态限制和 checkpoint 恢复已迁移 |
| 178 | `app/api/routes/trip_retry_endpoint_test.py:116::test_non_failed_is_409` | `port` | tests/trip-planning-http.test.ts, tests/task-store.test.ts | 同 task_id 重试、状态限制和 checkpoint 恢复已迁移 |
| 179 | `app/api/routes/trip_retry_endpoint_test.py:124::test_second_retry_while_processing_is_409` | `port` | tests/trip-planning-http.test.ts, tests/task-store.test.ts | 同 task_id 重试、状态限制和 checkpoint 恢复已迁移 |
| 180 | `app/api/routes/trip_retry_endpoint_test.py:135::test_concurrent_retries_only_start_once` | `port` | tests/trip-planning-http.test.ts, tests/task-store.test.ts | 同 task_id 重试、状态限制和 checkpoint 恢复已迁移 |
| 181 | `app/api/routes/trip_retry_endpoint_test.py:165::test_create_task_failure_rolls_back_and_allows_retry` | `port` | tests/trip-planning-http.test.ts, tests/task-store.test.ts | 同 task_id 重试、状态限制和 checkpoint 恢复已迁移 |
| 182 | `app/api/routes/trip_retry_endpoint_test.py:194::test_first_submit_uses_shared_start_helper` | `port` | tests/trip-planning-http.test.ts, tests/task-store.test.ts | 同 task_id 重试、状态限制和 checkpoint 恢复已迁移 |
| 183 | `app/api/routes/trip_stream_endpoint_test.py:53::test_parse_stream_emits_reply_deltas_then_final` | `port` | tests/trip-assistant-http.test.ts | parse/confirm SSE delta、final 和 DONE 契约已迁移 |
| 184 | `app/api/routes/trip_stream_endpoint_test.py:78::test_confirm_stream_emits_message_deltas_then_final` | `port` | tests/trip-assistant-http.test.ts | parse/confirm SSE delta、final 和 DONE 契约已迁移 |
| 185 | `app/models/schemas_test.py:85::test_trip_request_defaults_rooms_to_two_travelers_per_room` | `replace` | tests/domain-schemas.test.ts, ../frontend/src/utils/tripPresentation.test.mjs | DTO 严格性与展示蓝图兼容分别在后端和前端边界验证 |
| 186 | `app/models/schemas_test.py:97::test_accepts_blueprint_and_reference_times` | `replace` | tests/domain-schemas.test.ts, ../frontend/src/utils/tripPresentation.test.mjs | DTO 严格性与展示蓝图兼容分别在后端和前端边界验证 |
| 187 | `app/models/schemas_test.py:103::test_keeps_legacy_plan_without_blueprint` | `replace` | tests/domain-schemas.test.ts, ../frontend/src/utils/tripPresentation.test.mjs | DTO 严格性与展示蓝图兼容分别在后端和前端边界验证 |
| 188 | `app/models/schemas_test.py:115::test_normalizes_invalid_times_without_rejecting_plan` | `replace` | tests/domain-schemas.test.ts, ../frontend/src/utils/tripPresentation.test.mjs | DTO 严格性与展示蓝图兼容分别在后端和前端边界验证 |
| 189 | `app/models/schemas_test.py:123::test_discards_blueprint_with_duplicate_or_missing_days` | `replace` | tests/domain-schemas.test.ts, ../frontend/src/utils/tripPresentation.test.mjs | DTO 严格性与展示蓝图兼容分别在后端和前端边界验证 |
| 190 | `app/models/schemas_test.py:129::test_limits_each_blueprint_stage_to_three_highlights` | `replace` | tests/domain-schemas.test.ts, ../frontend/src/utils/tripPresentation.test.mjs | DTO 严格性与展示蓝图兼容分别在后端和前端边界验证 |
| 191 | `app/services/amap_service_test.py:24::test_attraction_research_preserves_trusted_poi_identity` | `port` | tests/amap-research-sources.test.ts | 可信 POI、酒店、无 key 和上游故障降级已迁移 |
| 192 | `app/services/amap_service_test.py:63::test_search_hotels_returns_only_valid_amap_pois` | `port` | tests/amap-research-sources.test.ts | 可信 POI、酒店、无 key 和上游故障降级已迁移 |
| 193 | `app/services/amap_service_test.py:93::test_search_poi_returns_empty_on_amap_api_error` | `port` | tests/amap-research-sources.test.ts | 可信 POI、酒店、无 key 和上游故障降级已迁移 |
| 194 | `app/services/amap_service_test.py:105::test_search_poi_prioritizes_exact_main_attraction` | `port` | tests/amap-research-sources.test.ts | 可信 POI、酒店、无 key 和上游故障降级已迁移 |
| 195 | `app/services/amap_service_test.py:147::test_search_poi_does_not_call_network_without_key` | `port` | tests/amap-research-sources.test.ts | 可信 POI、酒店、无 key 和上游故障降级已迁移 |
| 196 | `app/services/budget_guard_test.py:44::test_group_budget_limit_supports_per_person_basis` | `port` | tests/budget-guard.test.ts | 预算上限、待报价缓冲和餐饮调整逐例迁移 |
| 197 | `app/services/budget_guard_test.py:49::test_status_separates_current_overage_from_pending_buffer` | `port` | tests/budget-guard.test.ts | 预算上限、待报价缓冲和餐饮调整逐例迁移 |
| 198 | `app/services/budget_guard_test.py:67::test_generated_plan_reduces_only_meal_estimates_once` | `port` | tests/budget-guard.test.ts | 预算上限、待报价缓冲和餐饮调整逐例迁移 |
| 199 | `app/services/budget_guard_test.py:82::test_unsupported_persisted_locale_falls_back_to_chinese` | `port` | tests/budget-guard.test.ts | 预算上限、待报价缓冲和餐饮调整逐例迁移 |
| 200 | `app/services/budget_ledger_test.py:47::test_two_travelers_one_room_two_nights_is_900_total_and_450_per_person` | `port` | tests/budget-http.test.ts | 人数、房间、晚数、待报价和用户覆盖口径已迁移 |
| 201 | `app/services/budget_ledger_test.py:66::test_three_travelers_default_to_two_rooms` | `port` | tests/budget-http.test.ts | 人数、房间、晚数、待报价和用户覆盖口径已迁移 |
| 202 | `app/services/budget_ledger_test.py:76::test_unavailable_hotel_price_remains_pending` | `port` | tests/budget-http.test.ts | 人数、房间、晚数、待报价和用户覆盖口径已迁移 |
| 203 | `app/services/budget_ledger_test.py:86::test_diy_per_person_input_is_converted_to_group_total` | `port` | tests/budget-http.test.ts | 人数、房间、晚数、待报价和用户覆盖口径已迁移 |
| 204 | `app/services/budget_ledger_test.py:90::test_user_price_override_does_not_restore_provider_formula` | `port` | tests/budget-http.test.ts | 人数、房间、晚数、待报价和用户覆盖口径已迁移 |
| 205 | `app/services/chat_service_test.py:10::test_extracts_first_output_text` | `replace` | tests/trip-chat-service.test.ts, tests/trip-chat-http.test.ts | 整篇重写改为 revision-bound JSON Patch，并保留不可变事实和降级路径 |
| 206 | `app/services/chat_service_test.py:19::test_empty_output_returns_empty_string` | `replace` | tests/trip-chat-service.test.ts, tests/trip-chat-http.test.ts | 整篇重写改为 revision-bound JSON Patch，并保留不可变事实和降级路径 |
| 207 | `app/services/chat_service_test.py:25::test_edit_prompt_allows_blueprint_and_reference_times` | `replace` | tests/trip-chat-service.test.ts, tests/trip-chat-http.test.ts | 整篇重写改为 revision-bound JSON Patch，并保留不可变事实和降级路径 |
| 208 | `app/services/chat_service_test.py:29::test_validated_edit_keeps_updated_blueprint` | `replace` | tests/trip-chat-service.test.ts, tests/trip-chat-http.test.ts | 整篇重写改为 revision-bound JSON Patch，并保留不可变事实和降级路径 |
| 209 | `app/services/chat_service_test.py:40::test_invalid_edited_blueprint_degrades_without_rejecting_days` | `replace` | tests/trip-chat-service.test.ts, tests/trip-chat-http.test.ts | 整篇重写改为 revision-bound JSON Patch，并保留不可变事实和降级路径 |
| 210 | `app/services/chat_service_test.py:51::test_edit_agent_cannot_replace_verified_hotel` | `replace` | tests/trip-chat-service.test.ts, tests/trip-chat-http.test.ts | 整篇重写改为 revision-bound JSON Patch，并保留不可变事实和降级路径 |
| 211 | `app/services/flyai_provider_test.py:47::test_maps_structured_hotel_and_starting_price` | `retire` | - | FlyAI 已按用户决策从 TS 配置、依赖和运行时删除 |
| 212 | `app/services/flyai_provider_test.py:93::test_maps_masked_prices_to_auditable_lower_bounds` | `retire` | - | FlyAI 已按用户决策从 TS 配置、依赖和运行时删除 |
| 213 | `app/services/flyai_provider_test.py:117::test_rejects_malformed_json` | `retire` | - | FlyAI 已按用户决策从 TS 配置、依赖和运行时删除 |
| 214 | `app/services/flyai_provider_test.py:126::test_wraps_timeout_as_provider_error` | `retire` | - | FlyAI 已按用户决策从 TS 配置、依赖和运行时删除 |
| 215 | `app/services/flyai_provider_test.py:135::test_reports_missing_cli_without_running_a_shell` | `retire` | - | FlyAI 已按用户决策从 TS 配置、依赖和运行时删除 |
| 216 | `app/services/hotel_search_service_test.py:10::test_prefers_flyai_priced_inventory` | `retire` | - | FlyAI 酒店库存与补全链已删除；TS 仅接受高德可信酒店 POI |
| 217 | `app/services/hotel_search_service_test.py:28::test_falls_back_to_amap_identity_without_price` | `replace` | tests/amap-research-sources.test.ts | 酒店来源统一为高德可信 POI，不推测价格 |
| 218 | `app/services/hotel_search_service_test.py:51::test_enriches_missing_flyai_location_from_amap` | `retire` | - | FlyAI 酒店库存与补全链已删除；TS 仅接受高德可信酒店 POI |
| 219 | `app/services/itinerary_scheduler_test.py:37::test_fills_missing_times_and_marks_non_live_sources` | `port` | tests/itinerary-scheduler.test.ts, tests/pi-trip-planner.test.ts | 调度纯函数逐例迁移并接入最终计划 |
| 220 | `app/services/itinerary_scheduler_test.py:53::test_uses_forecast_basis_and_avoids_hot_afternoon_for_first_outdoor_stop` | `port` | tests/itinerary-scheduler.test.ts, tests/pi-trip-planner.test.ts | 调度纯函数逐例迁移并接入最终计划 |
| 221 | `app/services/itinerary_scheduler_test.py:70::test_preserves_existing_user_time_and_only_derives_missing_end` | `port` | tests/itinerary-scheduler.test.ts, tests/pi-trip-planner.test.ts | 调度纯函数逐例迁移并接入最终计划 |
| 222 | `app/services/itinerary_scheduler_test.py:80::test_schedules_missing_meals_around_attractions` | `port` | tests/itinerary-scheduler.test.ts, tests/pi-trip-planner.test.ts | 调度纯函数逐例迁移并接入最终计划 |
| 223 | `app/services/llm_service_test.py:60::test_disable_thinking_stream_uses_responses_reasoning_none` | `replace` | tests/pi-llm-client.test.ts | 旧 OpenAI SDK 封装由 pi-ai provider/stream 适配层替代 |
| 224 | `app/services/llm_service_test.py:81::test_non_deepseek_stream_omits_deepseek_reasoning_option` | `replace` | tests/pi-llm-client.test.ts | 旧 OpenAI SDK 封装由 pi-ai provider/stream 适配层替代 |
| 225 | `app/services/memory_service_test.py:12::test_recall_returns_empty_when_memory_unavailable` | `replace` | tests/hermes-memory-bridge.test.ts, tests/hermes-compatibility.test.ts, tests/auth-memory-http.test.ts | mem0 适配由用户隔离的 pi-hermes-memory 双存储桥替代 |
| 226 | `app/services/memory_service_test.py:16::test_recall_formats_results` | `replace` | tests/hermes-memory-bridge.test.ts, tests/hermes-compatibility.test.ts, tests/auth-memory-http.test.ts | mem0 适配由用户隔离的 pi-hermes-memory 双存储桥替代 |
| 227 | `app/services/memory_service_test.py:27::test_recall_swallow_exceptions` | `replace` | tests/hermes-memory-bridge.test.ts, tests/hermes-compatibility.test.ts, tests/auth-memory-http.test.ts | mem0 适配由用户隔离的 pi-hermes-memory 双存储桥替代 |
| 228 | `app/services/memory_service_test.py:33::test_remember_background_noops_without_user` | `replace` | tests/hermes-memory-bridge.test.ts, tests/hermes-compatibility.test.ts, tests/auth-memory-http.test.ts | mem0 适配由用户隔离的 pi-hermes-memory 双存储桥替代 |
| 229 | `app/services/memory_service_test.py:38::test_get_memory_returns_none_without_api_key` | `replace` | tests/hermes-memory-bridge.test.ts, tests/hermes-compatibility.test.ts, tests/auth-memory-http.test.ts | mem0 适配由用户隔离的 pi-hermes-memory 双存储桥替代 |
| 230 | `app/services/trip_confirmation_test.py:29::test_high_confidence_decision_issues_valid_token` | `port` | tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 签名语义、数值归一、过期和单次消费已迁移 |
| 231 | `app/services/trip_confirmation_test.py:35::test_invalid_confidence_does_not_issue_token` | `port` | tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 签名语义、数值归一、过期和单次消费已迁移 |
| 232 | `app/services/trip_confirmation_test.py:40::test_token_is_bound_to_all_execution_semantics` | `port` | tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 签名语义、数值归一、过期和单次消费已迁移 |
| 233 | `app/services/trip_confirmation_test.py:66::test_equivalent_integer_and_float_json_numbers_share_the_same_hash` | `port` | tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 签名语义、数值归一、过期和单次消费已迁移 |
| 234 | `app/services/trip_confirmation_test.py:87::test_zero_budget_is_not_equivalent_to_an_unspecified_budget` | `port` | tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 签名语义、数值归一、过期和单次消费已迁移 |
| 235 | `app/services/trip_confirmation_test.py:95::test_register_cleans_expired_entries_but_keeps_unexpired_consumed_entries` | `port` | tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 签名语义、数值归一、过期和单次消费已迁移 |
| 236 | `app/services/trip_confirmation_test.py:106::test_token_is_one_time` | `port` | tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 签名语义、数值归一、过期和单次消费已迁移 |
| 237 | `app/services/trip_confirmation_test.py:111::test_concurrent_consumers_only_consume_token_once` | `port` | tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 签名语义、数值归一、过期和单次消费已迁移 |
| 238 | `app/services/trip_confirmation_test.py:132::test_token_expires_at_exact_deadline` | `port` | tests/confirmation-ledger.test.ts, tests/trip-planning-http.test.ts | 签名语义、数值归一、过期和单次消费已迁移 |
| 239 | `app/services/user_service_test.py:21::test_login_creates_user_and_returns_stable_id` | `replace` | tests/http-contract.test.ts, tests/task-store.test.ts | 用户持久化并入 SQLite users 表和 auth HTTP 契约 |
| 240 | `app/services/user_service_test.py:28::test_login_normalizes_whitespace_and_casefold` | `replace` | tests/http-contract.test.ts, tests/task-store.test.ts | 用户持久化并入 SQLite users 表和 auth HTTP 契约 |
| 241 | `app/services/user_service_test.py:34::test_login_rejects_empty_and_too_long` | `replace` | tests/http-contract.test.ts, tests/task-store.test.ts | 用户持久化并入 SQLite users 表和 auth HTTP 契约 |
| 242 | `app/services/user_service_test.py:40::test_get_user` | `replace` | tests/http-contract.test.ts, tests/task-store.test.ts | 用户持久化并入 SQLite users 表和 auth HTTP 契约 |
| 243 | `app/services/user_service_test.py:45::test_persisted_across_reload` | `replace` | tests/http-contract.test.ts, tests/task-store.test.ts | 用户持久化并入 SQLite users 表和 auth HTTP 契约 |
