import requests
import pandas as pd
import re
import os
import io
import emoji
from pathlib import Path

# ================= 配置区域 =================

NHENTAI_SOURCES = {
    'Tags': 'https://raw.githubusercontent.com/MrRoiPanda/nhentaiTagsScrapper/refs/heads/main/database/tags.csv',
    'Parodies': 'https://raw.githubusercontent.com/MrRoiPanda/nhentaiTagsScrapper/refs/heads/main/database/parodies.csv',
    'Groups': 'https://raw.githubusercontent.com/MrRoiPanda/nhentaiTagsScrapper/refs/heads/main/database/groups.csv',
    'Characters': 'https://raw.githubusercontent.com/MrRoiPanda/nhentaiTagsScrapper/refs/heads/main/database/characters.csv',
    'Artists': 'https://raw.githubusercontent.com/MrRoiPanda/nhentaiTagsScrapper/refs/heads/main/database/artists.csv',
}

EHTAG_BASE = "https://raw.githubusercontent.com/EhTagTranslation/Database/refs/heads/master/database"
EHTAG_SOURCES = {
    'Artists': [f"{EHTAG_BASE}/artist.md"],
    'Groups': [f"{EHTAG_BASE}/group.md"],
    'Parodies': [f"{EHTAG_BASE}/parody.md"],
    'Characters': [f"{EHTAG_BASE}/character.md"],
    'Languages': [f"{EHTAG_BASE}/language.md"],
    'Tags': [
        f"{EHTAG_BASE}/female.md",
        f"{EHTAG_BASE}/male.md",
        f"{EHTAG_BASE}/location.md",
        f"{EHTAG_BASE}/mixed.md",
        f"{EHTAG_BASE}/other.md"
    ]
}

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
OUTPUT_DIR = REPO_ROOT / "nhentai_汉化标签库_Final"

# ================= 核心逻辑 =================

def contains_chinese(text):
    """判断字符串是否包含中文字符"""
    if not text:
        return False
    # 匹配 CJK 统一表意文字范围
    return bool(re.search(r'[\u4e00-\u9fff]', text))

def clean_markdown_cell(text):
    """清洗 Markdown 表格单元格"""
    if not isinstance(text, str):
        return ""

    # 1. [核心修复] 优先彻底移除 Markdown 图片语法 ![alt](url)
    text = re.sub(r'!\[.*?\]\(.*?\)', '', text)

    # 2. 处理 Markdown 链接 [text](url) -> text (保留文本)
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)

    # 3. 去 HTML 标签
    text = re.sub(r'<[^>]+>', '', text)

    # 4. 使用 emoji 库去除表情
    text = emoji.replace_emoji(text, replace='')

    # 5. 去除可能残留的额外空格
    return text.strip()

def fetch_and_parse_ehtag(urls):
    """下载并解析 EhTag 的 MD 文件 (包含中文优先逻辑)"""
    translation_dict = {}

    for url in urls:
        print(f"   -> 下载字典: {url.split('/')[-1]} ...")
        try:
            resp = requests.get(url)
            resp.raise_for_status()
            lines = resp.text.split('\n')

            for line in lines:
                if not line.strip().startswith('|') or '---|' in line:
                    continue

                parts = line.split('|')
                if len(parts) >= 3:
                    en_name = clean_markdown_cell(parts[1])
                    cn_name = clean_markdown_cell(parts[2])

                    # 跳过无效行或表头
                    if not en_name or en_name.lower() == 'name' or en_name == '名称':
                        continue

                    key = en_name.lower()

                    # --- 中文优先逻辑 ---
                    current_val = translation_dict.get(key)

                    is_new_chinese = contains_chinese(cn_name)
                    is_old_chinese = contains_chinese(current_val) if current_val else False

                    if is_new_chinese:
                        # 如果新值包含中文，优先使用（覆盖旧值，哪怕旧值也是中文，通常后读取的更准确）
                        translation_dict[key] = cn_name
                    elif not current_val:
                        # 如果没有旧值，不管是不是中文都存入
                        translation_dict[key] = cn_name
                    elif not is_old_chinese:
                        # 如果旧值不是中文，且新值也不是中文 -> 覆盖（保持最新）
                        translation_dict[key] = cn_name
                    else:
                        # 如果旧值是中文，而新值不是中文 -> 跳过（保留旧的中文翻译）
                        # 例如: 旧="更衣人偶...", 新="sono bisque doll..." -> 保留旧值
                        pass

        except Exception as e:
            print(f"      [警告] 字典下载失败: {e}")

    return translation_dict

def fetch_nhentai_tags(url):
    """下载 nhentai CSV"""
    print(f"   -> 下载 nhentai 数据: {url.split('/')[-1]} ...")
    try:
        resp = requests.get(url)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        return df
    except Exception as e:
        print(f"      [错误] CSV 下载失败: {e}")
        return None

def write_md(filepath, category, data_list, mode_name):
    """写入 MD 文件"""
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(f"# {category} {mode_name}\n\n")
        f.write(f"| nhentai Tag (英文) | 中文翻译 |\n")
        f.write("| --- | --- |\n")
        for en, cn in data_list:
            f.write(f"| {en} | {cn} |\n")

def generate_markdown_files(category, nh_df, trans_dict):
    """生成两个 Markdown 文件"""
    list_all = []
    list_translated = []
    match_count = 0
    total_count = 0

    for _, row in nh_df.iterrows():
        raw_name = row.get('name', row.iloc[1] if len(row) > 1 else '')
        tag_name = str(raw_name).strip()

        if not tag_name: continue
        total_count += 1

        cn_trans = trans_dict.get(tag_name.lower())

        if cn_trans:
            list_translated.append((tag_name, cn_trans))
            list_all.append((tag_name, cn_trans))
            match_count += 1
        else:
            list_all.append((tag_name, "-"))

    path_translated = os.path.join(OUTPUT_DIR, f"{category}_translated.md")
    write_md(path_translated, category, list_translated, "已汉化对照表")

    path_all = os.path.join(OUTPUT_DIR, f"{category}_all.md")
    write_md(path_all, category, list_all, "完整标签表")

    print(f"   [完成] {category}: 总计 {total_count}, 已汉化 {match_count} ({(match_count/total_count*100 if total_count else 0):.1f}%)")

def main():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    print("=== 开始处理标签汉化 (中文优先 + 修复Emoji/图片) ===")

    for category, nh_url in NHENTAI_SOURCES.items():
        print(f"\n正在处理分类: {category}")
        nh_df = fetch_nhentai_tags(nh_url)
        if nh_df is None: continue

        target_ehtag_files = EHTAG_SOURCES.get(category, [])
        if not target_ehtag_files: continue

        trans_dict = fetch_and_parse_ehtag(target_ehtag_files)
        generate_markdown_files(category, nh_df, trans_dict)

    print(f"\n正在处理分类: Languages")
    lang_dict = fetch_and_parse_ehtag(EHTAG_SOURCES['Languages'])
    lang_list = [(k, v) for k, v in lang_dict.items()]

    # 统一命名格式为 _translated.md 和 _all.md
    write_md(os.path.join(OUTPUT_DIR, "Languages_translated.md"), "Languages", lang_list, "已汉化对照表")
    write_md(os.path.join(OUTPUT_DIR, "Languages_all.md"), "Languages", lang_list, "完整标签表")
    print("   [完成] Languages 生成完毕")

    print(f"\n=== 全部完成！文件位于 '{OUTPUT_DIR}' ===")

if __name__ == "__main__":
    main()
