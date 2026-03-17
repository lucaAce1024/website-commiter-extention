 飞书电子表格查找 + 修改方案
                                                                                                                                                                                 
  1. 查找单元格 API                                               

  接口：POST /sheets/v3/spreadsheets/{spreadsheet_token}/sheets/{sheet_id}/find

  请求示例：
  curl -X POST 'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/{token}/sheets/{sheet_id}/find' \
  --header 'Authorization: Bearer <access_token>' \
  --header 'Content-Type: application/json' \
  --data '{
      "find_condition": {
          "range": "Sheet1!A1:C5",
          "match_case": true,
          "match_entire_cell": false,
          "search_by_regex": false,
          "include_formulas": false
      },
      "find": "hello"
  }'

  返回结果：
  {
      "code": 0,
      "msg": "success",
      "data": {
          "find_result": {
              "matched_cells": ["A1", "B2"],
              "matched_formula_cells": ["B3"],
              "rows_count": 2
          }
      }
  }

  2. 修改单元格 API

  找到单元格位置后，使用写入数据 API 修改：

  接口：PUT /sheets/v3/spreadsheets/{spreadsheet_token}/values

  请求示例：
  {
      "valueRange": {
          "range": "Sheet1!A1",
          "values": [["新内容"]]
      }
  }

  3. 一键替换 API

  飞书还提供替换单元格 API，可直接查找并替换：

  接口：POST /sheets/v3/spreadsheets/{spreadsheet_token}/sheets/{sheet_id}/replace

  ---
  查找条件参数说明

  ┌───────────────────┬─────────────────────────────┐
  │       参数        │            说明             │
  ├───────────────────┼─────────────────────────────┤
  │ range             │ 查找范围（如 Sheet1!A1:C5） │
  ├───────────────────┼─────────────────────────────┤
  │ match_case        │ 是否区分大小写              │
  ├───────────────────┼─────────────────────────────┤
  │ match_entire_cell │ 是否匹配整个单元格          │
  ├───────────────────┼─────────────────────────────┤
  │ search_by_regex   │ 是否使用正则表达式          │
  ├───────────────────┼─────────────────────────────┤
  │ include_formulas  │ 是否包含公式单元格          │
  └───────────────────┴─────────────────────────────┘

  ---
  完整工作流

  1. 调用 Find API → 获取 matched_cells（如 ["A1", "B2"]）
  2. 调用 Write API → 向这些单元格写入新数据

  或直接使用 Replace API 一步完成查找替换。

  ---
  Sources:
  - https://s.apifox.cn/apidoc/docs-site/532425/api-10048318
  - https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/sheets-v3/spreadsheet-sheet/find
