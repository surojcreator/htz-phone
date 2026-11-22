import glob
import os
import shutil
import zipfile

SRC = 'dist-ios-ipa/htz-phone-1.6.11-grantloop-unsigned.ipa'
OUT = 'dist-ios-ipa/htz-phone-1.6.12-shops-unsigned.ipa'
BUNDLE = glob.glob('dist-ios/_expo/static/js/ios/*.hbc')[0]

data = open(BUNDLE, 'rb').read()
assert data[:4].hex() == 'c61fbc03', 'not Hermes bytecode'

replaced = 0
with zipfile.ZipFile(SRC) as z:
    items = [(i, z.read(i.filename)) for i in z.infolist()]

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for info, body in items:
        if info.filename.endswith('main.jsbundle'):
            body = data
            replaced += 1
        z.writestr(info, body)

print('replaced', replaced, 'bundle bytes', len(data), '->', OUT, os.path.getsize(OUT))
