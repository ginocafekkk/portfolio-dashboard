#!/usr/bin/env python3
"""一站式持仓数据更新：价格 + 新闻 + 宏观指数 + 大类资产"""
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

# ====== 价格获取 ======
def fetch_price(ticker, retries=3):
    for attempt in range(retries):
        try:
            headers = {'User-Agent': UA, 'Accept': 'application/json'}
            url = f'https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=1d'
            r = requests.get(url, headers=headers, timeout=10)
            if r.status_code == 200:
                price = r.json()['chart']['result'][0]['meta']['regularMarketPrice']
                return round(price, 2)
        except:
            time.sleep(2)
    return None

# ====== 单一指数价格 ======
def fetch_index_price(ticker):
    """获取指数/ETF当前价格"""
    return fetch_price(ticker, retries=2)

# ====== 新闻获取（Yahoo Finance） ======
def fetch_news(ticker, market='us'):
    """从 Yahoo Finance 获取个股新闻，返回结构化列表"""
    news_list = []
    try:
        url = f'https://finance.yahoo.com/quote/{ticker}'
        headers = {'User-Agent': UA}
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            soup = BeautifulSoup(r.text, 'html.parser')
            # 尝试提取新闻条目
            items = soup.find_all('li', class_='js-stream-content')
            if not items:
                # 备用：找所有包含新闻的 section
                items = soup.select('section[data-testid="quoteNews"] ul li')
            for item in items[:3]:
                text = item.get_text(strip=True)
                if text and len(text) > 10:
                    news_list.append(text[:120])
        # 备用：RSS feed
        if not news_list:
            rss_url = f'https://feeds.content.dowjones.io/public/rss/mw_topstories'
            # Yahoo Finance 没有公开RSS了，试试 Google News
            g_url = f'https://news.google.com/rss/search?q={ticker}+stock&hl=en-US&gl=US&ceid=US:en'
            try:
                rg = requests.get(g_url, headers={'User-Agent': UA}, timeout=8)
                if rg.status_code == 200:
                    from xml.etree import ElementTree
                    root = ElementTree.fromstring(rg.content)
                    for item in root.findall('.//item')[:3]:
                        title = item.find('title')
                        if title is not None and title.text:
                            news_list.append(title.text[:120])
            except:
                pass
    except:
        pass
    return news_list

# ====== 指数数据（从Yahoo Finance获取） ======
def fetch_market_indices():
    """获取宏观指数数据"""
    indices_config = [
        {'key': 'sp500',     'name': '标普500',        'ticker': '^GSPC'},
        {'key': 'nasdaq',    'name': '纳斯达克',       'ticker': '^IXIC'},
        {'key': 'hshylv',    'name': '恒生低波红利',    'ticker': '^HSI'},
    ]
    indices = []
    for cfg in indices_config:
        price = fetch_index_price(cfg['ticker'])
        if price:
            indices.append({
                'key': cfg['key'],
                'name': cfg['name'],
                'value': round(price, 2),
                'change': 0,  # 简化：不追踪日变化
                'date': datetime.now().strftime('%m/%d'),
                'pe': None
            })
    return indices

# ====== 大类资产 ======
def fetch_assets():
    """获取大类资产走势"""
    asset_tickers = {
        '美元指数': 'DX-Y.NYB',
        '黄金': 'GC=F',
        '原油': 'CL=F',
        '10Y美债': '^TNX',
    }
    assets = []
    for name, ticker in asset_tickers.items():
        p = fetch_index_price(ticker)
        if p:
            assets.append({'name': name, 'value': str(p), 'change': 0})
    return assets

# ====== 格式化新闻为Dashboard格式 ======

# ====== 翻译（英→中） ======
def translate_en2zh(text):
    """将英文翻译为中文，使用 Google Translate"""
    if not text or re.search(r'[一-鿿]', text):
        return text  # 已有中文则跳过
    try:
        url = 'https://translate.googleapis.com/translate_a/single'
        params = {
            'client': 'gtx',
            'sl': 'en', 'tl': 'zh-CN',
            'dt': 't', 'q': text[:500]
        }
        r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=5)
        if r.status_code == 200:
            result = ''.join([part[0] for part in r.json()[0]])
            return result if result else text
    except:
        pass
    return text

def format_news(ticker, headlines, current_price):
    """将原始新闻转换为 dashboard 格式的 news item"""
    news_items = []
    for h in headlines[:2]:
        news_items.append({
            'source': '📰 实时资讯',
            'ticker': ticker,
            'text': translate_en2zh(h)
        })
    return news_items

# ====== 主函数 ======
def main():
    print(f"=== 全量数据更新 === {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    data = load_data()
    
    # 1️⃣ 更新价格
    print("\n--- 📈 更新价格 ---")
    price_updates = {}
    for market_key in ['us', 'hk']:
        for s in data['markets'][market_key]['stocks']:
            p = fetch_price(s['ticker'])
            if p:
                s['lastPrice'] = p
                price_updates[s['ticker']] = p
                print(f"  ✅ {s['ticker']}: ${p}")
            else:
                print(f"  ❌ {s['ticker']}: 失败")
    
    # 2️⃣ 更新新闻
    print("\n--- 📰 更新新闻 ---")
    all_news = []
    for market_key in ['us', 'hk']:
        for s in data['markets'][market_key]['stocks']:
            ticker = s['ticker']
            print(f"  🔍 搜索 {ticker} 新闻...", end=' ')
            headlines = fetch_news(ticker, market_key)
            if headlines:
                news_items = format_news(ticker, headlines, price_updates.get(ticker))
                all_news.extend(news_items)
                print(f"✅ ({len(headlines)}条)")
            else:
                print("⚠️ 无结果")
            time.sleep(0.5)  # 避免请求过快
    
    # 保留原有的操作记录类型新闻
    existing_news = [n for n in data.get('marketData', {}).get('news', []) if '操作记录' in n.get('source', '') or '🧸' in n.get('source', '')]
    all_news = existing_news + all_news
    
    # 3️⃣ 更新指数
    print("\n--- 📊 更新指数 ---")
    indices = fetch_market_indices()
    for idx in indices:
        print(f"  ✅ {idx['name']}: {idx['value']}")
    
    # 4️⃣ 更新大类资产
    print("\n--- 💹 更新大类资产 ---")
    assets = fetch_assets()
    for a in assets:
        print(f"  ✅ {a['name']}: {a['value']}")
    
    # 写入数据
    if 'marketData' not in data:
        data['marketData'] = {}
    data['marketData']['news'] = all_news
    data['marketData']['indices'] = indices
    data['marketData']['assets'] = assets
    data['lastUpdated'] = datetime.now().strftime('%Y-%m-%d')
    
    save_data(data)
    print(f"\n✅ 数据已更新至 {data['lastUpdated']}")
    print(f"  新闻: {len(all_news)}条 | 指数: {len(indices)}个 | 资产: {len(assets)}个")
    return 0

if __name__ == '__main__':
    sys.exit(main())
