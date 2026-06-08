#!/usr/bin/env python3
"""一站式持仓数据更新：价格 + 新闻 + 宏观指数 + 大类资产 + A股指数"""
import json, os, sys, time, re
from datetime import datetime
try:
    import requests
except ImportError:
    os.system('pip install requests -q')
    import requests
from bs4 import BeautifulSoup

DATA_FILE = 'data/portfolio.json'

def load_data():
    with open(DATA_FILE) as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

def fetch_price(ticker, retries=3):
    for attempt in range(retries):
        try:
            headers = {'User-Agent': UA, 'Accept': 'application/json'}
            url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=1d'
            r = requests.get(url, headers=headers, timeout=10)
            if r.status_code == 200:
                price = r.json()['chart']['result'][0]['meta']['regularMarketPrice']
                return price
        except:
            time.sleep(2)
    return None

def fetch_index_with_change(ticker):
    for attempt in range(3):
        try:
            headers = {'User-Agent': UA, 'Accept': 'application/json'}
            url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=5d'
            r = requests.get(url, headers=headers, timeout=10)
            if r.status_code == 200:
                result = r.json()['chart']['result'][0]
                meta = result['meta']
                price = meta.get('regularMarketPrice')
                prev_close = meta.get('chartPreviousClose')
                if price and prev_close and prev_close > 0:
                    change_pct = (price - prev_close) / prev_close * 100
                    return {'price': price, 'change_pct': change_pct}
            time.sleep(1)
        except:
            time.sleep(2)
    return None

def fetch_news(ticker, market='us'):
    news_list = []
    try:
        url = 'https://finance.yahoo.com/quote/' + ticker
        headers = {'User-Agent': UA}
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, 'html.parser')
            items = soup.find_all('li', class_='js-stream-content')
            if not items:
                items = soup.select('section[data-testid="quoteNews"] ul li')
            for item in items[:3]:
                link = item.find('a') if hasattr(item, 'find') else None
                href = link.get('href', '') if link else ''
                if href and not href.startswith('http'):
                    href = 'https://finance.yahoo.com' + href
                text = item.get_text(strip=True)
                if text and len(text) > 10:
                    news_list.append({'title': text[:150], 'url': href})
        if not news_list:
            g_url = 'https://news.google.com/rss/search?q=' + ticker + '+stock&hl=en-US&gl=US&ceid=US:en'
            try:
                rg = requests.get(g_url, headers={'User-Agent': UA}, timeout=8)
                if rg.status_code == 200:
                    from xml.etree import ElementTree
                    root = ElementTree.fromstring(rg.content)
                    for item in root.findall('.//item')[:3]:
                        title = item.find('title')
                        link = item.find('link')
                        t = title.text if title is not None else ''
                        l = link.text if link is not None else ''
                        if t:
                            news_list.append({'title': t[:150], 'url': l})
            except:
                pass
    except:
        pass
    return news_list

def fetch_market_indices():
    indices_config = [
        ('sp500',  '标普500',   '^GSPC'),
        ('nasdaq', '纳斯达克',  '^IXIC'),
        ('a500',   '中证A500',   '000510.SS'),
    ]

    # PE estimates (approximate, updated periodically)
    pe_estimates = {
        'sp500': 26.0,
        'nasdaq': 35.0,
        'a500': 15.0,
    }
    indices = []
    # Fetch HSHYLV from fund NAV
    try:
        headers = {'Referer': 'https://finance.sina.com.cn', 'User-Agent': UA}
        r = requests.get('https://hq.sinajs.cn/list=of021457', headers=headers, timeout=10)
        if r.status_code == 200 and r.text.strip():
            parts = r.text.split(',')
            if len(parts) >= 5 and parts[1] and parts[4]:
                fund_nav = float(parts[1])
                fund_change = float(parts[4])
                # Index ≈ NAV * 3700 (approximate ratio)
                hshylv_value = round(fund_nav * 3700, 2)
                indices.append({
                    'key': 'hshylv',
                    'name': '恒生红利低波',
                    'value': hshylv_value,
                    'change': round(fund_change, 2),
                    'date': datetime.now().strftime('%m/%d'),
                    'pe': 8.5
                })
                print('  \u2705 恒生红利低波: ' + str(hshylv_value) + ' (' + str(fund_change) + '%)')
            else:
                print('  \u274c 恒生红利低波: 获取失败')
    except Exception as e:
        print('  \u274c 恒生红利低波: ' + str(e))

    existing_keys = {idx['key'] for idx in indices}
    for key, name, ticker in indices_config:
        pd = fetch_index_with_change(ticker)
        if pd:
            v = round(pd['price'], 2)
            c = round(pd['change_pct'], 2)
            pe_val = pe_estimates.get(key)
            indices.append({
                'key': key,
                'name': name,
                'value': v,
                'change': c,
                'date': datetime.now().strftime('%m/%d'),
                'pe': pe_val
            })
            print('  \u2705 ' + name + ': ' + str(v) + ' (' + str(c) + '%)')
        else:
            print('  \u274c ' + name + ': \u83b7\u53d6\u5931\u8d25')
    return indices

def fetch_assets():
    asset_list = [
        ('美元指数', 'DX-Y.NYB'),
        ('黄金', 'GC=F'),
        ('原油', 'CL=F'),
        ('10Y美债', '^TNX'),
    ]
    assets = []
    for name, ticker in asset_list:
        pd = fetch_index_with_change(ticker)
        if pd:
            v = str(round(pd['price'], 2))
            c = round(pd['change_pct'], 2)
            assets.append({'name': name, 'value': v, 'change': c})
            print('  \u2705 ' + name + ': ' + v + ' (' + str(c) + '%)')
        else:
            print('  \u274c ' + name + ': \u83b7\u53d6\u5931\u8d25')
    return assets

def translate_en2zh(text):
    if not text or re.search(r'[\u4e00-\u9fff]', text):
        return text
    try:
        url = 'https://translate.googleapis.com/translate_a/single'
        params = {'client': 'gtx', 'sl': 'en', 'tl': 'zh-CN', 'dt': 't', 'q': text[:500]}
        r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=5)
        if r.status_code == 200:
            result = ''.join([part[0] for part in r.json()[0]])
            return result if result else text
    except:
        pass
    return text

def format_news(ticker, headlines, current_price):
    news_items = []
    for h in headlines[:2]:
        title = h['title'] if isinstance(h, dict) else h
        url = h.get('url', '') if isinstance(h, dict) else ''
        cn_title = translate_en2zh(title)
        news_items.append({'source': '\U0001f4f0 \u5b9e\u65f6\u8d44\u8baf', 'ticker': ticker, 'text': cn_title, 'url': url})
    return news_items



def fetch_a_share_price_with_change(ticker):
    """从新浪获取A股基金最新净值和日涨跌幅"""
    try:
        headers = {'Referer': 'https://finance.sina.com.cn', 'User-Agent': UA}
        url = 'https://hq.sinajs.cn/list=of' + ticker
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200 and r.text.strip():
            parts = r.text.split(',')
            if len(parts) >= 5 and parts[1]:
                net_value = float(parts[1])
                change_pct = float(parts[4]) if parts[4] else 0
                return {'net_value': net_value, 'change_pct': change_pct}
    except:
        pass
    return None
def main():
    today_str = datetime.now().strftime('%Y-%m-%d %H:%M')
    print('=== \u5168\u91cf\u6570\u636e\u66f4\u65b0 === ' + today_str)
    data = load_data()

    # 1. 更新价格
    print('\n--- \U0001f4c8 \u66f4\u65b0\u4ef7\u683c ---')
    price_updates = {}
    for market_key in ['us', 'hk', 'a']:
        market = data['markets'].get(market_key)
        if not market or 'stocks' not in market:
            continue
        for s in market['stocks']:
            if market_key == 'a':
                a_data = fetch_a_share_price_with_change(s['ticker'])
                if a_data and s.get('lastPrice'):
                    s['lastPrice'] = round(s['lastPrice'] * (1 + a_data['change_pct'] / 100.0), 2)
                    p = s['lastPrice']
                    price_updates[s['ticker']] = p
                    print('  \u2705 ' + s['ticker'] + ': \u00a5' + str(p))
                else:
                    print('  \u274c ' + s['ticker'] + ': \u83b7\u53d6\u5931\u8d25')
            else:
                p = fetch_price(s['ticker'])
                if p:
                    s['lastPrice'] = p
                    price_updates[s['ticker']] = p
                    print('  \u2705 ' + s['ticker'] + ': $' + str(p))
                else:
                    print('  \u274c ' + s['ticker'] + ': \u5931\u8d25')

    # 2. 更新新闻
    print('\n--- \U0001f4f0 \u66f4\u65b0\u65b0\u95fb ---')
    all_news = []
    for market_key in ['us', 'hk']:
        market = data['markets'].get(market_key)
        if not market or 'stocks' not in market:
            continue
        for s in market['stocks']:
            ticker = s['ticker']
            print('  \U0001f50d ' + ticker + ' \u65b0\u95fb...', end=' ')
            headlines = fetch_news(ticker, market_key)
            if headlines:
                news_items = format_news(ticker, headlines, price_updates.get(ticker))
                all_news.extend(news_items)
                print('\u2705 (' + str(len(headlines)) + '\u6761)')
            else:
                print('\u26a0\ufe0f \u65e0\u7ed3\u679c')
            time.sleep(0.5)

    existing_news = [n for n in data.get('marketData', {}).get('news', []) if '\u64cd\u4f5c\u8bb0\u5f55' in n.get('source', '') or '\U0001f9f8' in n.get('source', '')]
    all_news = existing_news + all_news

    # 3. 更新指数
    print('\n--- \U0001f4ca \u66f4\u65b0\u6307\u6570 ---')
    indices = fetch_market_indices()

    # 4. 更新大类资产
    print('\n--- \U0001f4b9 \u66f4\u65b0\u5927\u7c7b\u8d44\u4ea7 ---')
    assets = fetch_assets()

    if 'marketData' not in data:
        data['marketData'] = {}
    data['marketData']['news'] = all_news
    data['marketData']['indices'] = indices
    data['marketData']['assets'] = assets
    data['lastUpdated'] = datetime.now().strftime('%Y-%m-%d')

    save_data(data)
    print('\n\u2705 \u6570\u636e\u5df2\u66f4\u65b0\u81f3 ' + data['lastUpdated'])
    print('  \u65b0\u95fb: ' + str(len(all_news)) + '\u6761 | \u6307\u6570: ' + str(len(indices)) + '\u4e2a | \u8d44\u4ea7: ' + str(len(assets)) + '\u4e2a')
    return 0

if __name__ == '__main__':
    sys.exit(main())

