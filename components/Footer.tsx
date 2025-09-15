import React from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface FooterProps {
  className?: string;
  textWhite?: boolean;
  showSponsor?: boolean;
}

export default function Footer({ className = "footer", textWhite = false }: FooterProps) {
  return (
    <footer className={className} style={{ color: textWhite ? 'white' : '' }}>
      <p>
        本项目绝赞靠爱发电中，
      </p>
      <p>欢迎在爱发电上赞助我们！</p>
      <p style={{ textAlign: 'center', display: 'flex', justifyContent: 'center' }}>
        <Link href="https://afdian.com/a/colanns" target="_blank" rel="noopener noreferrer">
          {textWhite ? <Image src="/afdian-white.svg" alt="afdian" width={120} height={20} /> : <Image src="/afdian.svg" alt="afdian" width={120} height={20} />}
        </Link>
      </p>
      <p>
        交流群 <a href="https://qun.qq.com/universal-share/share?ac=1&busi_data=eyJncm91cENvZGUiOiIxMDU5ODMwOTUyIiwidG9rZW4iOiJNUFN6UVpBRVZNNU9COWpBa21DU1lxczRObXhiKy9kSzEvbHhOcnNpT1RBZEVRU3dtZ2hUQjJVNGtuYk5ISDhrIiwidWluIjoiMTAxOTcyNzcxMCJ9&data=DxfxSXDeGY3mgLKqoTGEoHkfqpums19TEW8Alu5Ikc3uCmV0O8YkLVLyRTMOp61VjFN387-7QL8-j2AFHUX2QXq525oXb8rl0lNhm0K453Q&svctype=5&tempid=h5_group_info" target="_blank" rel="noopener noreferrer" className="footer-link">1059830952</a>
      </p>
      <p>
        设计与制作 <a href="https://github.com/notuhao" target="_blank" rel="noopener noreferrer" className="footer-link">@末伏之夜</a>
      </p>
      <p>
        程序与美工 <a href="https://github.com/colasama" target="_blank" rel="noopener noreferrer" className="footer-link">@Colanns</a>
      </p>
      <p>
        本项目 AI 能力由&nbsp;
        <a href="https://github.com/KouriChat/KouriChat" target="_blank" rel="noopener noreferrer" className="footer-link">KouriChat</a> &&nbsp;
        <a href="https://api.kourichat.com/" target="_blank" rel="noopener noreferrer" className="footer-link">Kouri API</a>
        &nbsp;强力支持
      </p>
      <p>
        <a href="https://github.com/colasama/MahoShojo-Generator" target="_blank" rel="noopener noreferrer" className="footer-link">colasama/MahoShojo-Generator</a>
      </p>
    </footer>
  );
}