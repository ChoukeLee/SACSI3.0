"""Print existing DR key; no key bytes in source, console, or QA preview."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'output/pdf/recovery-key'
QA = ROOT / 'work/recovery-key-print-qa'
KEY = ROOT / 'work/disaster-recovery-keys/backup-PNLJiW.key'
BACKUP = Path('D:/SACSI-Backups/2026-09-23_191732Z_backup-PNLJiW')


def secure_directory(path):
    path.mkdir(parents=True, exist_ok=True)
    assert not path.is_symlink()
    sid = re.search(r'S-1-5-[0-9-]+', subprocess.check_output(
        ['whoami.exe', '/user', '/fo', 'csv', '/nh'], text=True)).group()
    subprocess.run(['icacls.exe', str(path), '/inheritance:r', '/grant:r',
                    f'*{sid}:(OI)(CI)F'], check=True, capture_output=True)


def decrypt(blob, key):
    assert blob[:10] == b'SACSI-DR-1'
    return AESGCM(key).decrypt(blob[10:22], blob[22:], b'SACSI-DR-1')


def render(path, hex_key, checksum, masked=False):
    c = canvas.Canvas(str(path), pagesize=(595.276, 841.89))
    c.setTitle('SACSI 备份密钥恢复单 - backup-PNLJiW')
    c.setAuthor('SACSI')
    c.setFillColor(HexColor('#172832'))

    def text(x, y, value, size=11, font='Chinese'):
        assert x + pdfmetrics.stringWidth(value, font, size) <= 552
        c.setFont(font, size)
        c.drawString(x, y, value)

    def paragraph(value, y, size=11, leading=20):
        line = ''
        for char in value:
            if pdfmetrics.stringWidth(line + char, 'Chinese', size) > 500:
                text(46, y, line, size)
                y -= leading
                line = ''
            line += char
        if line:
            text(46, y, line, size)
        return y - leading

    text(46, 788, 'SACSI 备份密钥恢复单', 23)
    text(46, 758, '机密：持有此单和对应备份，就可能读取完整业务及账号数据。', 11)
    c.setStrokeColor(HexColor('#BAC5CB'))
    c.line(46, 742, 548, 742)
    text(46, 714, '对应备份：backup-PNLJiW', 12)
    text(46, 690, '数据时间：2026-09-23 19:17:32 UTC（阿比让时间）', 11)
    text(46, 666, '以下两行合起来是一份完整密钥，顺序不能颠倒。', 11)
    c.setFillColor(HexColor('#F0F3F5'))
    c.roundRect(46, 563, 502, 83, 7, fill=1, stroke=0)
    c.setFillColor(HexColor('#172832'))
    groups = [hex_key[i:i+8] for i in range(0, 64, 8)]
    for index, y in enumerate([616, 583]):
        text(60, y, f'R{index+1}', 11, 'Courier')
        text(99, y, ' '.join(groups[index*4:(index+1)*4]), 18, 'Courier')
    text(46, 537, '密钥校验指纹（SHA-256 前 16 位）：', 11)
    text(46, 514, checksum, 14, 'Courier')
    paragraph('恢复码共 64 位，只包含数字 0-9 和字母 A-F；数字 0 不是字母 O。恢复时去掉空格，按 R1、R2 顺序连接，不包含行号。校验指纹不是密钥的一部分。', 483)
    text(46, 407, '需要恢复时', 14)
    paragraph('1. 找到对应移动硬盘备份目录与本恢复单，先核对备份编号。', 379)
    paragraph('2. 将两行恢复码按十六进制还原为 32 字节密钥，核对上方指纹，再验证加密文件。不要直接覆盖线上数据库。', 351)
    paragraph('3. 请维护人员使用 SACSI-DR-1 / AES-256-GCM 恢复工具处理。硬盘目录附有 dr-archive.mjs 和灾备说明。', 305)
    text(46, 245, '打印与保管', 14)
    paragraph('使用可信的本地打印机，A4 单面、黑白、实际大小即可。检查两行恢复码均完整清晰。不要发到群聊、公共打印店或共享云盘。', 218)
    paragraph('纸张放在与电脑、备份硬盘不同的安全地点。每个新备份可能使用不同密钥，本单只对应 backup-PNLJiW，不能保证解开未来备份。', 168)
    paragraph('确认打印清楚并妥善收好后，可让维护人员删除本机打印用 PDF；不要删除原始密钥文件。', 118)
    c.setStrokeColor(HexColor('#BAC5CB'))
    c.line(46, 68, 548, 68)
    text(46, 48, '生成日期：2026-09-24  |  1 / 1' + ('  |  脱敏排版检查副本' if masked else ''), 9)
    c.showPage()
    c.save()


def main():
    assert os.name == 'nt'
    secure_directory(OUTPUT)
    secure_directory(QA)
    pdfmetrics.registerFont(TTFont('Chinese', 'C:/Windows/Fonts/msyh.ttc', subfontIndex=0))
    key = KEY.read_bytes()
    assert len(key) == 32
    target = OUTPUT / 'SACSI-backup-PNLJiW-recovery-key.pdf'
    # Existing output is only verified, never silently replaced.
    if not target.exists():
        render(target, key.hex().upper(), hashlib.sha256(key).hexdigest()[:16].upper())
    with pdfplumber.open(target) as doc:
        assert len(doc.pages) == 1
        page = doc.pages[0]
        content = page.extract_text()
        rows = []
        for baseline in [616, 583]:
            row_text = page.crop((95, page.height-baseline-24,
                                  548, page.height-baseline+6)).extract_text()
            assert re.fullmatch(r'[0-9A-F]{8}(?:\s+[0-9A-F]{8}){3}', row_text)
            rows.append(re.sub(r'\s+', '', row_text))
        recovered = bytes.fromhex(''.join(rows))
        assert recovered == key
        for char in page.chars:
            assert 0 <= char['x0'] < char['x1'] <= page.width
            assert 0 <= char['top'] < char['bottom'] <= page.height
    manifest = json.loads(decrypt((BACKUP / 'manifest.json.aes').read_bytes(), recovered))
    count = 0
    for file in BACKUP.glob('*.aes'):
        plaintext = decrypt(file.read_bytes(), recovered)
        if file.name == 'database.dump.aes':
            assert hashlib.sha256(plaintext).hexdigest() == manifest['dumpSha256']
        count += 1
    assert count == 5
    render(QA / 'masked-layout.pdf', 'X' * 64, 'X' * 16, masked=True)
    (OUTPUT / 'verification.json').write_text(json.dumps({
        'backupId': 'backup-PNLJiW', 'pdfPages': 1, 'pdfTextKeyMatchesOriginal': True,
        'usbEncryptedFilesDecrypted': count, 'databaseHashMatches': True,
        'printedOnPaper': False, 'keyStoredSeparatelyOnPaper': False,
    }, indent=2), encoding='utf-8')
    print('PASS: one-page PDF; recovered printed code matches key; 5 USB encrypted files verified; no key printed to console.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No traceback/locals/secret-bearing PDF text in logs.
        print('Recovery-sheet generation failed: ' + type(error).__name__)
        raise SystemExit(1)
