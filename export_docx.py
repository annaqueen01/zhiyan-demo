#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
智研 · 论文初稿导出为 .docx

设计要点
--------
1. 学术排版按国内经管期刊惯例：
   - 正文中文用宋体，标题用思源黑体，拉丁字母与数字用 Times New Roman
   - 数字必须是 Times New Roman：python-docx 需要显式设置 w:rFonts 的
     ascii/hAnsi 与 eastAsia 两套字体，否则 Word 会用中文字体渲染数字
   - 行距 1.5，段首缩进 2 字符（用 w:ind 的 firstLineChars，符合东亚版式）
2. 三线表：顶线与底线 1.5pt，表头下分隔线 0.75pt，无竖线
3. 每张表下面必须有注与数据来源
4. 披露章节强制存在：未做的检验、无法完成的检验、待补文献
   —— 这是产品核心承诺，导出链路不能把它丢掉
5. 不做样式伪造：数据里缺失的数字写"—"，不猜。

用法
----
    python export_docx.py --in bundle.json --out 论文初稿.docx
    python export_docx.py --in bundle.json --out 论文初稿.docx --title "自定义标题"
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

# ---------------------------------------------------------------- 字体常量
FONT_LATIN = "Times New Roman"
FONT_HAN_BODY = "宋体"
FONT_HAN_HEAD = "思源黑体 CN"
FONT_HAN_KAI = "楷体"

BODY_SIZE = Pt(10.5)   # 五号
H1_SIZE = Pt(14)
H2_SIZE = Pt(12)
TITLE_SIZE = Pt(16)
NOTE_SIZE = Pt(8.5)


# ---------------------------------------------------------------- 底层工具
def set_run_fonts(run, latin=FONT_LATIN, han=FONT_HAN_BODY, size=None, bold=None):
    """同时设置西文与东亚字体。

    只设 run.font.name 是不够的：Word 用 eastAsia 字体渲染中文、
    用 ascii/hAnsi 渲染数字与字母，两者必须分别指定，否则数字会被
    中文字体接管，在学术排版里很难看。
    """
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), latin)
    rfonts.set(qn("w:hAnsi"), latin)
    rfonts.set(qn("w:eastAsia"), han)
    rfonts.set(qn("w:cs"), latin)
    if size is not None:
        run.font.size = size
    if bold is not None:
        run.font.bold = bold


def set_first_line_indent(paragraph, chars=2):
    """按"字符"设置首行缩进（东亚版式的正确做法）。"""
    ppr = paragraph._p.get_or_add_pPr()
    ind = ppr.find(qn("w:ind"))
    if ind is None:
        ind = OxmlElement("w:ind")
        ppr.append(ind)
    ind.set(qn("w:firstLineChars"), str(int(chars * 100)))
    ind.set(qn("w:firstLine"), str(int(chars * 240)))


def para(doc, text="", *, size=BODY_SIZE, han=FONT_HAN_BODY, latin=FONT_LATIN,
         bold=False, align=None, indent=0, space_before=0, space_after=0,
         line=1.5, keep_with_next=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing = line
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    if align is not None:
        p.alignment = align
    if indent:
        set_first_line_indent(p, indent)
    if keep_with_next:
        pf.keep_with_next = True
    if text:
        run = p.add_run(text)
        set_run_fonts(run, latin=latin, han=han, size=size, bold=bold)
    return p


def _set_cell_border(cell, edge, sz=8, color="000000", val="single"):
    """sz 单位为 1/8 pt：6 = 0.75pt，12 = 1.5pt"""
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.find(qn("w:tcBorders"))
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    el = borders.find(qn("w:" + edge))
    if el is None:
        el = OxmlElement("w:" + edge)
        borders.append(el)
    el.set(qn("w:val"), val)
    el.set(qn("w:sz"), str(sz))
    el.set(qn("w:space"), "0")
    el.set(qn("w:color"), color)


def three_line_table(doc, header, rows, *, widths=None, align_right_from=1,
                     total_width_cm=14.6):
    """三线表：顶线/底线粗，表头下线细，无竖线。"""
    ncols = len(header)
    table = doc.add_table(rows=1, cols=ncols)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False

    tbl_pr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "none")
        borders.append(el)
    tbl_pr.append(borders)

    for i, text in enumerate(header):
        cell = table.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after = Pt(2)
        run = p.add_run(str(text))
        set_run_fonts(run, han=FONT_HAN_HEAD, size=Pt(9), bold=True)

    for r in rows:
        cells = table.add_row().cells
        for i, val in enumerate(r[:ncols]):
            cell = cells[i]
            cell.text = ""
            p = cell.paragraphs[0]
            p.alignment = (WD_ALIGN_PARAGRAPH.RIGHT
                           if i >= align_right_from else WD_ALIGN_PARAGRAPH.LEFT)
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.space_after = Pt(1)
            run = p.add_run("" if val is None else str(val))
            set_run_fonts(run, han=FONT_HAN_BODY, size=Pt(9))

    for cell in table.rows[0].cells:
        _set_cell_border(cell, "top", sz=12)
        _set_cell_border(cell, "bottom", sz=6)
    for cell in table.rows[-1].cells:
        _set_cell_border(cell, "bottom", sz=12)

    if widths:
        total = sum(widths) or 1
        for row in table.rows:
            for i, w in enumerate(widths):
                if i < len(row.cells):
                    row.cells[i].width = Cm(total_width_cm * w / total)
    return table



def as_text(v, default="—"):
    """把任意值安全地变成可拼接的字符串。

    bundle 由页面生成，同一字段可能是字符串、数字或对象
    （例如 provenance.engine 可能是 {name, version}）。
    直接拼接会 TypeError，所以统一在这里归一。
    """
    if v is None:
        return default
    if isinstance(v, str):
        return v or default
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, dict):
        for key in ("name", "label", "id", "title", "message", "value", "version"):
            if v.get(key):
                return as_text(v[key], default)
        return ", ".join("%s=%s" % (k, as_text(x, "")) for k, x in v.items()) or default
    if isinstance(v, (list, tuple)):
        return " + ".join(as_text(x, "") for x in v) or default
    return str(v)

def fmt_num(v, nd=3):
    if v is None:
        return "—"
    if isinstance(v, str):
        return v
    try:
        return f"{float(v):.{nd}f}"
    except (TypeError, ValueError):
        return str(v)


# ---------------------------------------------------------------- 正文构建
def build(bundle: dict, out_path: Path, title_override=None):
    doc = Document()

    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(2.54)
    sec.bottom_margin = Cm(2.54)
    sec.left_margin = Cm(3.17)
    sec.right_margin = Cm(3.17)

    normal = doc.styles["Normal"]
    normal.font.name = FONT_LATIN
    normal.font.size = BODY_SIZE
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT_HAN_BODY)

    paper = bundle.get("paper") or {}
    meta = bundle.get("meta") or {}
    steps = bundle.get("steps") or {}
    wording = paper.get("wording", "associative")
    title = as_text(title_override or meta.get("title"), "未命名论文")

    para(doc, title, size=TITLE_SIZE, han=FONT_HAN_HEAD, bold=True,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=6, line=1.5)

    secs = paper.get("sections") or []
    # 摘要：既支持独立的抽象小节，也支持数据里没有小节时由调用方提供 abstract 字段
    abstract_paras = []
    abstract_sec = next(
        (s for s in secs
         if str(s.get("id", "")).lower() in ("abstract", "zh-abstract")
         or "摘要" in str(s.get("title", ""))),
        None,
    )
    if abstract_sec:
        abstract_paras = [p.get("text", "") for p in abstract_sec.get("paragraphs", [])]
    elif paper.get("abstract"):
        abstract_paras = ([paper["abstract"]] if isinstance(paper["abstract"], str)
                          else list(paper["abstract"]))

    if abstract_paras:
        para(doc, "摘　要", size=H2_SIZE, han=FONT_HAN_HEAD, bold=True,
             align=WD_ALIGN_PARAGRAPH.CENTER, space_before=6, space_after=4)
        for t in [as_text(x, "") for x in abstract_paras]:
            para(doc, t, han=FONT_HAN_KAI, indent=2)
    if paper.get("keywords"):
        para(doc, "关键词：" + "；".join(as_text(k) for k in paper["keywords"]),
             han=FONT_HAN_KAI, space_before=4, space_after=10)

    wcount = 0
    for s in secs:
        if s.get("id") == "abstract":
            continue
        no = s.get("no", "")
        head = f"{as_text(no)}、{as_text(s.get('title'), '')}" if no else as_text(s.get("title"), "")
        if not head:
            continue
        para(doc, head, size=H1_SIZE, han=FONT_HAN_HEAD, bold=True,
             space_before=10, space_after=4, keep_with_next=True)
        for p in s.get("paragraphs", []):
            text = p.get("text", "")
            if not text:
                continue
            wcount += len(text)
            if p.get("unverified"):
                text += "［此处待补文献：该论断在现有文献库中找不到依据］"
            para(doc, text, indent=2)

    tables_added = _add_result_tables(doc, steps)
    _add_references(doc, bundle)
    _add_disclosure(doc, bundle, steps, wording)
    _add_writing_note(doc, bundle, wcount, tables_added)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path))
    return {
        "ok": True,
        "path": str(out_path),
        "bytes": out_path.stat().st_size,
        "sections": len([s for s in secs if s.get("id") != "abstract"]),
        "tables": tables_added,
        "chars": wcount,
        "wording": wording,
    }


def _add_result_tables(doc, steps):
    """把每一步的结果表写进正文。优先用 pipeline 的真实计算结果。"""
    added = 0
    order = ["data-prep", "descriptive", "baseline", "robustness",
             "endogeneity", "heterogeneity", "mechanism"]
    for step_id in order:
        st = steps.get(step_id)
        if not st:
            continue
        label = as_text(st.get("label"), "") or step_id
        for t in (st.get("tables") or []):
            cap = as_text(t.get("caption"), "") or f"表　{label}"
            header = t.get("header") or []
            rows = t.get("rows") or []
            if not header or not rows:
                continue
            para(doc, cap, size=Pt(9.5), han=FONT_HAN_HEAD, bold=True,
                 align=WD_ALIGN_PARAGRAPH.CENTER, space_before=8, space_after=2)
            three_line_table(doc, header, rows)
            note_text = "　".join(x for x in [
                ("注：" + as_text(t["note"])) if t.get("note") else "",
                ("数据来源：" + as_text(t["source"])) if t.get("source") else "",
            ] if x)
            if note_text:
                para(doc, note_text, size=NOTE_SIZE, han=FONT_HAN_KAI,
                     space_before=2, space_after=6)
            added += 1
    return added


def _add_references(doc, bundle):
    refs = bundle.get("references") or []
    if not refs:
        return
    para(doc, "参考文献", size=H1_SIZE, han=FONT_HAN_HEAD, bold=True,
         space_before=12, space_after=4, keep_with_next=True)
    for i, r in enumerate(refs, 1):
        if isinstance(r, dict):
            text = as_text(r.get("text"), "")
            if not text:
                bits = [r.get("authors", ""), r.get("title", ""),
                        r.get("journal", ""), str(r.get("year", ""))]
                text = ". ".join(b for b in bits if b)
        else:
            text = str(r)
        para(doc, f"[{i}] {text}", size=Pt(9.5), space_after=2, line=1.25)


def _add_disclosure(doc, bundle, steps, wording):
    """披露章节：产品核心承诺，导出链路必须保留。"""
    para(doc, "附：方法与披露说明", size=H1_SIZE, han=FONT_HAN_HEAD, bold=True,
         space_before=14, space_after=4, keep_with_next=True)

    wording_label = {"causal": "因果", "associative": "相关",
                     "descriptive": "描述"}.get(wording, wording)

    lines = [
        f"（一）措辞强度。本文全文采用「{wording_label}」表述强度，该强度由结论类型与"
        f"识别策略检查清单共同推导，不随结果是否显著而临时调整。"
    ]
    skipped = bundle.get("skippedSteps") or []
    lines.append("（二）未做的检验。" + ("　".join(as_text(s) for s in skipped) if skipped else "无。"))
    cannot = bundle.get("cannotDo") or []
    lines.append("（三）无法完成的检验。" + ("　".join(as_text(c) for c in cannot) if cannot else "无。"))

    unverified = bundle.get("unverifiedCount")
    if unverified is None:
        unverified = sum(1
                         for s in (bundle.get("paper") or {}).get("sections", [])
                         for p in s.get("paragraphs", [])
                         if p.get("unverified"))
    lines.append(f"（四）待补文献。全文共 {unverified} 处论断在现有文献库中找不到依据，"
                 f"已在正文中逐处标注，未作静默删除，也未编造出处。")

    sj = (bundle.get("paper") or {}).get("styleJournal")
    if sj:
        lines.append(f"（五）语言风格。行文结构参照《{sj}》的组织方式与语体，"
                     f"仅模仿形式，未搬运任何原句。")

    for line in lines:
        para(doc, line, size=Pt(10), han=FONT_HAN_KAI, indent=2, space_after=2)


def _add_writing_note(doc, bundle, wcount, tables):
    para(doc, "附：本文档的生成说明", size=H2_SIZE, han=FONT_HAN_HEAD, bold=True,
         space_before=10, space_after=4, keep_with_next=True)
    prov = bundle.get("provenance") or {}
    notes = [
        f"正文约 {wcount} 字，含 {tables} 张结果表。",
        ("生成时间：" + as_text(bundle.get("generatedAt"))) if bundle.get("generatedAt") else "",
        "计量引擎：" + as_text(prov.get("engine"), "内置 OLS/固定效应/聚类标准误实现"),
        f"样本量：{as_text(prov.get('nObs'))}；聚类层级：{as_text(prov.get('cluster'))}",
        "本文件由「智研」导出。所有系数、标准误与显著性均为程序计算所得；"
        "若与 Stata 等权威软件存在差异，请以权威软件为准。",
    ]
    for n in notes:
        if n:
            para(doc, n, size=Pt(9), han=FONT_HAN_KAI, space_after=2)


# ---------------------------------------------------------------- 入口
def load_bundle(path):
    if path is None or str(path) == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(path).read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise SystemExit("输入 JSON 顶层必须是对象")
    return data


def main(argv=None):
    ap = argparse.ArgumentParser(description="智研 · 导出论文初稿为 .docx")
    ap.add_argument("--in", dest="inp", default="-",
                    help="项目包 JSON 路径；省略或 - 表示从 stdin 读取")
    ap.add_argument("--out", dest="out", required=True, help="输出 .docx 路径")
    ap.add_argument("--title", dest="title", default=None, help="覆盖标题")
    args = ap.parse_args(argv)

    bundle = load_bundle(None if args.inp == "-" else args.inp)
    result = build(bundle, Path(args.out), args.title)
    try:
        print(json.dumps(result, ensure_ascii=False))
    except UnicodeEncodeError:
        print(json.dumps(result, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
