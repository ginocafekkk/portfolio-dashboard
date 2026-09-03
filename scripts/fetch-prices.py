#!/usr/bin/env python3
"""Fetch latest stock prices and update portfolio.json — v2 with retry"""
import json, os, sys, time
from datetime import datetime, timedelta, timezone
try:
    import requests
except ImportError:
    os.system('pip install requests -q')
    import requests

DATA_FILE = 'data/portfolio.json'

def load_data():
    with open(DATA_FILE) as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

UA_LIST = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
]

def fetch_price(ticker, retries=4):
    """Fetch stock price from Yahoo Finance with retry.

    Returns (price, trade_date): price rounded to 2dp, trade_date is the
    exchange-local trading date (YYYY-MM-DD) of that price. None on failure.
    """
    for attempt in range(retries):
        try:
            ua = UA_LIST[attempt % len(UA_LIST)]
            headers = {'User-Agent': ua, 'Accept': 'application/json'}
            for url in (
                f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d',
                f'https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d',
            ):
                try:
                    r = requests.get(url, headers=headers, timeout=12)
                    if r.status_code == 200:
                        meta = r.json()['chart']['result'][0]['meta']
                        price = round(meta['regularMarketPrice'], 2)
                        # 交易所本地交易日: regularMarketTime + gmtoffset(秒, EDT=-14400/HKT=28800)
                        local = datetime.fromtimestamp(
                            meta['regularMarketTime'], tz=timezone.utc
                        ) + timedelta(seconds=meta.get('gmtoffset', 0))
                        return (price, local.strftime('%Y-%m-%d'))
                except Exception:
                    continue
        except:
            pass
        time.sleep(2)
    return None

def fetch_a_fund_price(ticker):
    """Fetch A-share fund NAV from Sina Finance"""
    try:
        headers = {'Referer': 'https://finance.sina.com.cn', 'User-Agent': UA_LIST[0]}
        r = requests.get(f'https://hq.sinajs.cn/list=of{ticker}', headers=headers, timeout=10)
        if r.status_code == 200 and r.text.strip():
            parts = r.text.split(',')
            if len(parts) >= 6 and parts[1]:
                nav = float(parts[1])
                change_pct = float(parts[4]) if parts[4] else 0
                nav_date = parts[5].strip().rstrip('";\n').strip()
                return {'nav': nav, 'change_pct': change_pct, 'nav_date': nav_date}
    except:
        pass
    return None

def main():
    print(f"=== 自动更新持仓数据 ===", datetime.now())
    data = load_data()
    
    print("\n--- 美股 ---")
    us_ok, us_fail = 0, 0
    for s in data['markets']['us']['stocks']:
        p = fetch_price(s['ticker'])
        if p:
            s['lastPrice'] = p[0]
            s['lastUpdated'] = p[1]
            us_ok += 1
            print(f"  ✅ {s['ticker']}: ${p[0]} @ {p[1]}")
        else:
            us_fail += 1
            print(f"  ❌ {s['ticker']}: 失败")
    
    print("\n--- 港股 ---")
    hk_ok, hk_fail = 0, 0
    for s in data['markets']['hk']['stocks']:
        p = fetch_price(s['ticker'])
        if p:
            s['lastPrice'] = p[0]
            s['lastUpdated'] = p[1]
            hk_ok += 1
            print(f"  ✅ {s['ticker']}: HK${p[0]} @ {p[1]}")
        else:
            hk_fail += 1
            print(f"  ❌ {s['ticker']}: 失败")
    
    print("\n--- A股个股 ---")
    a_ok, a_fail = 0, 0
    for s in data['markets']['a']['stocks']:
        # 基金用新浪净值
        if s.get('benchmark') or s['ticker'][0] == '0' and len(s['ticker']) == 6:
            fund = fetch_a_fund_price(s['ticker'])
            if fund:
                # navDate 防重：同一净值日期不重复计算
                if s.get('navDate') == fund['nav_date']:
                    a_ok += 1
                    print(f"  ⏭️ {s['ticker']} {s['name']}: 净值已更新 ({fund['nav_date']}), 跳过")
                    continue
                # shares=1, lastPrice=总市值；用净值变化%更新市值
                change_ratio = 1 + fund['change_pct'] / 100.0
                base = s.get('lastPrice')
                if base is None:
                    base = s.get('avgCost', 0)
                    print(f"  ⚠️ {s['ticker']} {s['name']}: lastPrice缺失, 从avgCost初始化")
                s['lastPrice'] = round(base * change_ratio, 2)
                s['navDate'] = fund['nav_date']
                a_ok += 1
                print(f"  ✅ {s['ticker']} {s['name']}: ¥{s['lastPrice']}")
            else:
                a_fail += 1
                print(f"  ❌ {s['ticker']} {s['name']}: 获取净值失败")
        else:
            # 个股用Yahoo Finance
            p = fetch_price(s['ticker'])
            if p:
                s['lastPrice'] = p[0]
                s['lastUpdated'] = p[1]
                a_ok += 1
                print(f"  ✅ {s['ticker']} {s['name']}: ¥{p[0]} @ {p[1]}")
            else:
                a_fail += 1
                print(f"  ❌ {s['ticker']} {s['name']}: 失败")
    
    print(f"\n📊 结果: 美股 {us_ok}✓/{us_fail}✗ | 港股 {hk_ok}✓/{hk_fail}✗ | A股 {a_ok}✓/{a_fail}✗")
    
    data['lastUpdated'] = datetime.now().strftime('%Y-%m-%d')
    save_data(data)
    print(f"✅ 数据已更新至 {data['lastUpdated']}")
    return 0

if __name__ == '__main__':
    sys.exit(main())
