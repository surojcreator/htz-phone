import re
d = open('../bundle_dec.js', 'rb').read().decode('utf-8', 'ignore')
for pat in ['pro_refund', 'proRefund', 'pro_state', 'checkProState', 'claim', 'redeem', 'coinz', 'Coinz', 'benefit', 'Benefit']:
    ms = [m.start() for m in re.finditer(pat, d)]
    print('\n==', pat, len(ms), ms[:10])
    for s in ms[:4]:
        seg = d[max(0, s - 600):s + 700].replace('\r', ' ')
        print(seg.encode('ascii', 'replace').decode('ascii'))
