#!/usr/bin/env python3
"""每周流动性报告生成器 → 输出 Markdown 格式适合微信推送"""
import json, os, sys
from datetime import datetime

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'portfolio.json')

def load():
    with open(DATA_FILE) as f:
        return json.load(f)

def fmt_factor(f):
    icons = {'bullish': '✅', 'neutral': '➖', 'bearish': '⚠️'}
    return f"  {icons[f['status']]} {f['name']}: {f['value']}（{f['weight']}）— {f['detail']}"

def generate():
    data = load()
    liq = data.get('liquidity', {})
    if not liq:
        return "⚠️ 数据中缺少 liquidity 字段"
    
    updated = liq.get('lastUpdated', '--')
    
    lines = []
    lines.append(f"🌊 全球市场流动性周报")
    lines.append(f"📅 {updated}\n")
    
    for key, label, flag in [('US', '美股', '🇺🇸'), ('HK', '港股', '🇭🇰'), ('A', 'A股', '🇨🇳')]:
        mkt = liq.get(key)
        if not mkt:
            continue
        
        bullish = [f for f in mkt['factors'] if f['status'] == 'bullish']
        bearish = [f for f in mkt['factors'] if f['status'] == 'bearish']
        neutral = [f for f in mkt['factors'] if f['status'] == 'neutral']
        
        lines.append(f"\n{flag} {label} | {mkt['rating']} | {mkt['score']}/100 {mkt['trend']}")
        lines.append(f"📝 {mkt['summary']}")
        lines.append(f"")
        
        # Factor summary: show count
        lines.append(f"  利多 {len(bullish)} · 中性 {len(neutral)} · 利空 {len(bearish)}")
        lines.append(f"")
        
        # Key bearish factors
        if bearish:
            lines.append(f"⚠️ 主要风险因子：")
            for f in bearish[:5]:
                lines.append(fmt_factor(f))
        
        # Key bullish factors
        if bullish:
            lines.append(f"")
            lines.append(f"✅ 主要支撑因子：")
            for f in bullish[:3]:
                lines.append(fmt_factor(f))
    
    # Cross-market comparison
    lines.append(f"\n━━━━━━━━━━━━━━━━━")
    lines.append(f"📊 三市场对比")
    lines.append(f"")
    for key, label, flag in [('US', '美股', '🇺🇸'), ('HK', '港股', '🇭🇰'), ('A', 'A股', '🇨🇳')]:
        mkt = liq.get(key)
        if mkt:
            lines.append(f"  {flag} {label}: {mkt['score']}/100 — {mkt['rating']} {mkt['trend']}")
    
    # Key events this week
    lines.append(f"\n━━━━━━━━━━━━━━━━━")
    lines.append(f"📅 本周关注")
    lines.append(f"  🔴 6月16日 日本央行议息（加息概率88%）")
    lines.append(f"  🔴 6月中旬 美联储沃什国会听证")
    lines.append(f"  🔴 6月末 南向资金半年度考核")
    lines.append(f"  🔴 6月末 公募基金半年度调仓")
    lines.append(f"  ⚠️ 中东局势（霍尔木兹海峡封锁已3月+）")
    
    lines.append(f"\n🧸 Labuster · 数据仅供参考")
    
    return '\n'.join(lines)

if __name__ == '__main__':
    report = generate()
    print(report)
