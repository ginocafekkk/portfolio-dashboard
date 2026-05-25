#!/usr/bin/env python3
"""Fetch latest stock prices and update portfolio.json"""
import json, os, re
from datetime import datetime, time
try:
    import requests
except ImportError:
    os.system('pip install requests')
    import requests

DATA_FILE = 'data/portfolio.json'

def load_data():
    with open(DATA_FILE) as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def fetch_yahoo(ticker):
    """Fetch stock price from Yahoo Finance"""
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d'
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        data = r.json()
        return round(data['chart']['result'][0]['meta']['regularMarketPrice'], 2)
    except:
        return None

def fetch_fund_eastmoney(code):
    """Fetch A-share fund NAV from East Money"""
    url = f'https://fundgz.1234567.com.cn/js/{code}.js'
    headers = {'Referer': 'https://fund.eastmoney.com/'}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        # Response format: jsonpgz({"fundcode":"021457",...});
        match = re.search(r'jsonpgz\(({.*?})\)', r.text)
        if match:
            data = json.loads(match.group(1))
            # Use estimated NAV (gsz) or actual NAV (dwjz)
            nav = float(data.get('gsz', 0)) or float(data.get('dwjz', 0))
            return round(nav, 4)
    except:
        pass
    # Fallback: try actual NAV
    try:
        url2 = f'https://fund.eastmoney.com/pingzhongdata/{code}.js'
        r2 = requests.get(url2, headers=headers, timeout=10)
        # Extract Data_netWorthTrend
        match2 = re.search(r'Data_netWorthTrend\s*=\s*(\[.*?\]);', r2.text, re.DOTALL)
        if match2:
            trend = json.loads(match2.group(1))
            if trend:
                return round(float(trend[-1]['y']), 4)
    except:
        pass
    return None

def fetch_forex(pair):
    """Fetch forex rate"""
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{pair}=X?interval=1d&range=1d'
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        return round(r.json()['chart']['result'][0]['meta']['regularMarketPrice'], 4)
    except:
        return None

def fetch_option_price(ticker, strike, expiry):
    """Fetch current option mid/price from Yahoo Finance"""
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
    try:
        from datetime import datetime
        exp_date = datetime.strptime(expiry, '%Y-%m-%d')
        ts = int(exp_date.timestamp())
        # Need crumb for Yahoo options API
        sess = requests.Session()
        sess.headers.update(headers)
        sess.get('https://fc.yahoo.com/')
        crumb_r = sess.get('https://query2.finance.yahoo.com/v1/test/getcrumb')
        if crumb_r.status_code != 200:
            return None
        crumb = crumb_r.text.strip()
        url = f'https://query2.finance.yahoo.com/v7/finance/options/{ticker}?date={ts}&crumb={crumb}'
        r = sess.get(url, timeout=10)
        data = r.json()
        for option_list in data['optionChain']['result'][0]['options']:
            for put in option_list['puts']:
                if abs(put['strike'] - strike) < 0.01:
                    return round(put['lastPrice'], 2)
        return None
    except:
        return None

def main():
    print("=== 自动更新持仓数据 ===", datetime.now())
    data = load_data()
    
    # US stocks
    print("\n--- 美股 ---")
    for s in data['markets']['us']['stocks']:
        p = fetch_yahoo(s['ticker'])
        if p:
            s['lastPrice'] = p
            print(f"  {s['ticker']}: ${p}")
        else:
            print(f"  {s['ticker']}: 失败 (保留 ${s['lastPrice']})")
    
    # HK stocks
    print("\n--- 港股 ---")
    for s in data['markets']['hk']['stocks']:
        p = fetch_yahoo(s['ticker'])
        if p:
            s['lastPrice'] = p
            print(f"  {s['ticker']}: HK${p}")
        else:
            print(f"  {s['ticker']}: 失败 (保留 HK${s['lastPrice']})")
    
    # A-share ETFs
    print("\n--- A股基金 ---")
    for s in data['markets']['a']['stocks']:
        p = fetch_fund_eastmoney(s['ticker'])
        if p:
            s['lastPrice'] = p
            print(f"  {s['ticker']} {s['name']}: ¥{p}")
        else:
            print(f"  {s['ticker']}: 失败 (保留 ¥{s['lastPrice']})")
    
    # Forex
    print("\n--- 汇率 ---")
    hkd = fetch_forex('USDHKD')
    if hkd:
        data['fx']['USD_HKD'] = hkd
        print(f"  USD/HKD: {hkd}")
    cny = fetch_forex('USDCNY')
    if cny:
        data['fx']['USD_CNY'] = cny
        print(f"  USD/CNY: {cny}")
    
    data['lastUpdated'] = datetime.now().strftime('%Y-%m-%d')
    
    # Options pricing (US only, HK options not available via Yahoo)
    print("\n--- 期权当前价格 ---")
    for o in data['options']:
        ticker = o['ticker']
        if '.' in ticker or '/' in ticker:
            print(f"  {ticker}: 港股期权暂不支持抓取")
            o['currentPrice'] = None
            continue
        p = fetch_option_price(ticker, o['strike'], o['expiry'])
        if p is not None:
            o['currentPrice'] = p
            diff = o['premium'] - p
            emoji = '💰' if diff >= 0 else '📉'
            print(f"  {ticker} ${o['strike']} {o['expiry']}: 当前${p} (卖出${o['premium']}) {emoji} {diff:+.0f}")
        else:
            o['currentPrice'] = None
            print(f"  {ticker} ${o['strike']} {o['expiry']}: 未获取到（可能API限流）")
    
    save_data(data)
    print(f"\n✅ 数据已更新至 {data['lastUpdated']}")
    return 0

if __name__ == '__main__':
    exit(main())
