<template>
  <main class="privacy-page">
    <article class="privacy-content">
      <p class="privacy-eyebrow">PRIVACY</p>
      <h1>隐私说明与用户协议</h1>
      <p class="privacy-date">更新日期：2026 年 8 月 27 日</p>

      <section>
        <h2>账号与身份</h2>
        <p>游伴使用微信登录建立业务账号，不向客户端提供 openid、session_key 或服务端密钥。微信头像仅在你主动选择后上传，用于当前游伴账号。旅行需求、对话和生成的行程用于提供规划、恢复和历史记录。</p>
      </section>
      <section>
        <h2>位置与地图</h2>
        <p>仅在你主动查看地图或导航时调用地图能力。没有可信国内坐标的地点不会发起定位导航。</p>
      </section>
      <section>
        <h2>公开分享</h2>
        <p>分享链接只包含随机分享令牌，接收者只能只读查看该行程。请勿在行程中填写不必要的敏感信息。</p>
      </section>
      <section>
        <h2>会话与退出</h2>
        <p>你可以撤销其他设备会话或退出当前设备。小程序中的相册、日历和地图能力仅在你主动操作时调用，并遵循微信系统授权。</p>
      </section>
    </article>
  </main>
</template>

<style scoped>
.privacy-page {
  min-height: 100vh;
  min-height: 100dvh;
  padding: 48px 24px 80px;
  background: var(--surface-page, #faf7f2);
  color: var(--text-primary, #3d3229);
}
.privacy-content { width: min(100%, 720px); margin: 0 auto; }
.privacy-eyebrow { margin: 0; color: var(--accent-strong, #b85738); font-size: 12px; font-weight: 700; }
h1 { margin: 8px 0 0; font-size: 32px; line-height: 1.3; }
.privacy-date { margin: 8px 0 40px; color: var(--text-secondary, #6b5d52); font-size: 13px; }
section { padding: 28px 0; border-top: 1px solid var(--border-subtle, #ded4ca); }
h2 { margin: 0 0 10px; font-size: 18px; line-height: 1.4; }
section p { margin: 0; color: var(--text-secondary, #6b5d52); font-size: 15px; line-height: 1.9; }
@media (max-width: 420px) {
  .privacy-page { padding: 32px 20px 64px; }
  h1 { font-size: 27px; }
}
</style>
