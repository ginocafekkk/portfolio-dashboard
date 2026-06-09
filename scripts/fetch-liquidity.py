#!/usr/bin/env python3
"""流动性因子数据自动更新脚本
从公开 API 抓取关键指标，更新 portfolio.json 中的 liquidity 数值
保留定性判断（评级/趋势/解读），仅刷新可量化的指标数值
"""
import json, os, sys, time
from datetime import datetime

try:
    import requests
except ImportError:
    os.system('pip install requests -q')
    import requests

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'portfolio.json')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

def load():
    with open(DATA_FILE) as f:
        return json.load(f)

def save(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def fetch_json(url, timeout=15):
    for attempt in range(3):
        try:
            r = requests.get(url, headers={'User-Agent': UA}, timeout=timeout)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            print(f"  ⚠️  attempt {attempt+1} failed: {e}")
            time.sleep(2)
    return None

def safe_get(d, *keys, default='--'):
    for k in keys:
        if isinstance(d, dict):
            d = d.get(k, default)
        elif isinstance(d, (list, tuple)) and isinstance(k, int) and k < len(d):
            d = d[k]
        else:
            return default
    return d if d is not None else default

def get_meta_price(raw):
    """从 Yahoo chart response 提取 regularMarketPrice"""
    try:
        val = safe_get(raw, 'chart', 'result', 0, 'meta', 'regularMarketPrice')
        return val if isinstance(val, (int, float)) else None
    except:
        return None

def get_meta_volume(raw):
    """提取 regularMarketVolume"""
    try:
        val = safe_get(raw, 'chart', 'result', 0, 'meta', 'regularMarketVolume')
        return val if isinstance(val, (int, float)) else None
    except:
        return None

def update_liquidity(data):
    today = datetime.now().strftime('%Y-%m-%d')
    liq = data.get('liquidity', {})
    if not liq:
        print("⚠️  no liquidity section, skipping")
        return

    liq['lastUpdated'] = today
    us = liq.get('US', {}).get('factors', [])
    hk = liq.get('HK', {}).get('factors', [])
    a = liq.get('A', {}).get('factors', [])

    factors_map = {}
    for f in us:  factors_map[('US', f['name'])] = f
    for f in hk:  factors_map[('HK', f['name'])] = f
    for f in a:   factors_map[('A', f['name'])]  = f

    def update_factor(market, name, value, status=None):
        key = (market, name)
        if key in factors_map:
            print(f"    → 更新 {market}.{name}: '{factors_map[key]['value']}' → '{value}'")
            factors_map[key]['value'] = value
            if status:
                factors_map[key]['status'] = status
        else:
            print(f"    ⚠️ 未找到因子 ({market}, {name})")

    # === 1. YAHOO FINANCE: 关键指数 ===
    print("📡 获取市场指数...")

    # VIX
    vix_data = fetch_json('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d')
    if vix_data:
        val = get_meta_price(vix_data)
        if val:
            update_factor('US', 'VIX', f"~{val:.0f}")
            status = 'bearish' if val > 25 else ('neutral' if val > 18 else 'neutral')
            update_factor('US', 'VIX', f"~{val:.0f}", status)
            print(f"  VIX: {val:.0f}")

    # DXY
    dxy_data = fetch_json('https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?interval=1d&range=1d')
    if dxy_data:
        val = get_meta_price(dxy_data)
        if val:
            update_factor('HK', '美元指数(DXY)', f"~{val:.1f}")
            status = 'bullish' if val < 99 else ('neutral' if val < 101 else 'bearish')
            update_factor('HK', '美元指数(DXY)', f"~{val:.1f}", status)
            print(f"  DXY: {val:.1f}")

    # 美债10Y
    tnx_data = fetch_json('https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=1d')
    if tnx_data:
        val = get_meta_price(tnx_data)
        if val:
            update_factor('US', '国债发行/TGA', f"10Y {val:.2f}%")
            print(f"  10Y yield: {val:.2f}%")

    # === 2. 中国利率（跳过，Yahoo不支持中国债券收益率） ===
    print("📡 跳过中国债券收益率...")

    # === 3. CNH / 人民币汇率 ===
    print("📡 获取人民币汇率...")
    cnh_data = fetch_json('https://query1.finance.yahoo.com/v8/finance/chart/CNY=X?interval=1d&range=1d')
    if cnh_data:
        val = get_meta_price(cnh_data)
        if val:
            update_factor('A', '人民币汇率', f"~{val:.4f}")
            status = 'bullish' if val < 7.0 else ('neutral' if val < 7.3 else 'bearish')
            update_factor('A', '人民币汇率', f"~{val:.4f}", status)
            print(f"  USD/CNY: {val:.4f}")

    # === 4. 港元汇率 ===
    print("📡 获取港元汇率...")
    hkd_data = fetch_json('https://query1.finance.yahoo.com/v8/finance/chart/HKD=X?interval=1d&range=1d')
    if hkd_data:
        val = get_meta_price(hkd_data)
        if val:
            status_val = 'bearish' if val > 7.83 else ('neutral' if val > 7.78 else 'bullish')
            update_factor('HK', '港元汇率', f"~{val:.4f}", status_val)
            print(f"  USD/HKD: {val:.4f}")

    # === 5. 沪深300指数成交量（A股活跃度信号） ===
    print("📡 获取沪深300成交量...")
    csi_data = fetch_json('https://query1.finance.yahoo.com/v8/finance/chart/000300.SS?interval=1d&range=1d')
    if csi_data:
        vol = get_meta_volume(csi_data)
        if vol:
            vol_yi = vol / 1e8
            update_factor('A', 'A股成交量', f"CSI300 {vol_yi:.1f}亿股")
            print(f"  CSI300 vol: {vol_yi:.1f}亿股")

    # === 6. 信用利差（HYG 价格逆相关） ===
    print("📡 获取信用利差...")
    hyg_data = fetch_json('https://query1.finance.yahoo.com/v8/finance/chart/HYG?interval=1d&range=1d')
    if hyg_data:
        val = get_meta_price(hyg_data)
        if val:
            update_factor('US', '信用利差', f"HYG ${val:.2f}")
            print(f"  HYG price: ${val:.2f}")

    # Mark update time
    liq['lastUpdated'] = today
    print(f"\n✅ 流动性数据更新完成 ({today})")

if __name__ == '__main__':
    data = load()
    update_liquidity(data)
    save(data)
    print("✅ 已保存到 portfolio.json")
