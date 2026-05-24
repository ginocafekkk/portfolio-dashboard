#!/usr/bin/env python3
"""Fetch latest stock prices and update portfolio.json"""
import json, os, re
from datetime import datetime
try:
    import requests
except ImportError:
    os.system('pip install requests beautifulsoup4')
    import requests

DATA_FILE = 'data/portfolio.json'

def load_data():
    with open(DATA_FILE) as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def fetch_yahoo_price(ticker):
    """Fetch stock price from Yahoo Finance"""
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d'
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        data = r.json()
        result = data['chart']['result'][0]
        meta = result['meta']
        return round(meta['regularMarketPrice'], 2)
    except:
        return None

def fetch_yahoo_hk(ticker):
    """Fetch HK stock price"""
    return fetch_yahoo_price(ticker + '.HK')

def fetch_forex(pair):
    """Fetch forex rate from Yahoo Finance"""
    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{pair}=X?interval=1d&range=1d'
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        r = requests.get(url, headers=headers, timeout=10)
        data = r.json()
        price = data['chart']['result'][0]['meta']['regularMarketPrice']
        return round(price, 4)
    except:
        return None

def main():
    print("=== Fetching Portfolio Prices ===", datetime.now())
    data = load_data()
    
    # Update US stocks
    print("\n--- US Stocks ---")
    for s in data['markets']['us']['stocks']:
        price = fetch_yahoo_price(s['ticker'])
        if price:
            s['lastPrice'] = price
            print(f"  {s['ticker']}: ${price}")
        else:
            print(f"  {s['ticker']}: FAILED (keeping ${s['lastPrice']})")
    
    # Update HK stocks
    print("\n--- HK Stocks ---")
    for s in data['markets']['hk']['stocks']:
        price = fetch_yahoo_price(s['ticker'])
        if price:
            s['lastPrice'] = price
            print(f"  {s['ticker']}: HK${price}")
        else:
            print(f"  {s['ticker']}: FAILED (keeping HK${s['lastPrice']})")
    
    # Update forex rates
    print("\n--- Forex ---")
    hkd = fetch_forex('USDHKD')
    if hkd:
        data['fx']['USD_HKD'] = hkd
        print(f"  USD/HKD: {hkd}")
    cny = fetch_forex('USDCNY')
    if cny:
        data['fx']['USD_CNY'] = cny
        print(f"  USD/CNY: {cny}")
    
    # Update date
    data['lastUpdated'] = datetime.now().strftime('%Y-%m-%d')
    
    save_data(data)
    print(f"\n✅ Updated {DATA_FILE}")
    return 0

if __name__ == '__main__':
    exit(main())
