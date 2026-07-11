#!/usr/bin/env python3
"""Fetch latest stock prices and update portfolio.json — v2 with retry"""
import json, os, sys, time
from datetime import datetime
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
    """Fetch stock price from Yahoo Finance with retry"""
    for attempt in range(retries):
        try:
            ua = UA_LIST[attempt % len(UA_LIST)]
            headers = {'User-Agent': ua, 'Accept': 'application/json'}
            # Try primary endpoint
            url = f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d'
            r = requests.get(url, headers=headers, timeout=12)
            if r.status_code == 200:
                data = r.json()
                price = data['chart']['result'][0]['meta']['regularMarketPrice']
                return round(price, 2)
            # Try backup endpoint
            url2 = f'https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d'
            r = requests.get(url2, headers=headers, timeout=12)
            if r.status_code == 200:
                data = r.json()
                price = data['chart']['result'][0]['meta']['regularMarketPrice']
                return round(price, 2)
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
            if len(parts) >= 5 and parts[1]:
                nav = float(parts[1])
                change_pct = float(parts[4]) if parts[4] else 0
                return {'nav': nav, 'change_pct': change_pct}
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
            s['lastPrice'] = p
            us_ok += 1
            print(f"  ✅ {s['ticker']}: ${p}")
        else:
            us_fail += 1
            print(f"  ❌ {s['ticker']}: 失败")
    
    print("\n--- 港股 ---")
    hk_ok, hk_fail = 0, 0
    for s in data['markets']['hk']['stocks']:
        p = fetch_price(s['ticker'])
        if p:
            s['lastPrice'] = p
            hk_ok += 1
            print(f"  ✅ {s['ticker']}: HK${p}")
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
                # shares=1, lastPrice=总市值；用净值变化%更新市值
                change_ratio = 1 + fund['change_pct'] / 100.0
                s['lastPrice'] = round(s['lastPrice'] * change_ratio, 2)
                a_ok += 1
                print(f"  ✅ {s['ticker']} {s['name']}: ¥{s['lastPrice']}")
            else:
                a_fail += 1
                print(f"  ❌ {s['ticker']} {s['name']}: 获取净值失败")
        else:
            # 个股用Yahoo Finance
            p = fetch_price(s['ticker'])
            if p:
                s['lastPrice'] = p
                a_ok += 1
                print(f"  ✅ {s['ticker']} {s['name']}: ¥{p}")
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
