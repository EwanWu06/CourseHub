import type { ReactNode } from 'react';
import { Masthead } from '../components/ui.tsx';
import { Link } from '../router.tsx';

function Q({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="card faq">
      <summary>{q}</summary>
      <div className="faq-a">{children}</div>
    </details>
  );
}

function Term({ k, children }: { k: ReactNode; children: ReactNode }) {
  return <div className="term-row"><span className="term-k">{k}</span><span className="grow">{children}</span></div>;
}

export function Help() {
  return (
    <div className="page help">
      <Masthead kicker="Help" title="帮助" />

      <section className="section">
        <div className="section-head"><h2>每天怎么用</h2></div>
        <ol className="steps">
          <li><b>早上看「<Link to="/">今天</Link>」或 7:00 的日报</b>：今天要交什么、接下来 3 天、近期考试，AI 帮你排好上午/下午/晚上。</li>
          <li><b>做完一项就点左边的圆圈</b>：只在本机记「已完成」，不会改 Canvas。Canvas 上交了的会自动显示已完成。</li>
          <li><b>学新内容去「<Link to="/study">学习</Link>」</b>：每门课每周一份中文讲解，有核心概念、例子、易错点和自测题，出处标到课件第几页。</li>
          <li><b>周日晚上看周报</b>：下周每天要交什么、哪天最忙、有什么考试。</li>
          <li>找东西按 <kbd>⌘</kbd> <kbd>K</kbd> 搜索，作业、课程、文件、公告都能搜。</li>
        </ol>
      </section>

      <section className="section">
        <div className="section-head"><h2>标签和状态是什么意思</h2></div>
        <div className="card card-pad terms">
          <Term k={<span className="seal seal-sm">考</span>}>考试或测验（看的是真实分类，不只是 Canvas 里的类型；比如化学的 Knowledge Check 是考试，章节 Homework 是作业）。分类不对可以点标签改。</Term>
          <Term k={<span className="badge">大纲</span>}>这个日期是从课程大纲（syllabus）里读出来的，Canvas 上没写；任务下面会附上大纲原文，方便核对。</Term>
          <Term k={<span className="badge warn">逾期</span>}>过了截止时间、Canvas 上还没交。</Term>
          <Term k={<span className="badge bad">缺交</span>}>老师在 Canvas 里标了 missing。</Term>
          <Term k={<span className="badge">已过</span>}>已经过去、不需要在网上提交的（比如纸质作业、课堂考试）。</Term>
          <Term k={<span className="small" style={{ color: 'var(--amber)' }}>外部工具 · 以平台为准</span>}>在 Macmillan Learning 等外部平台完成的作业，完成情况以那个平台为准。</Term>
          <Term k={<span className="badge">日程</span>}>Canvas 日历里的活动，不用交东西。</Term>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>登录是怎么保持的</h2></div>
        <div className="card card-pad prose">
          <p>你在 Chrome 里正常登录一次学校，Course Hub 就记住这次登录（只存在这台 Mac 上），之后：</p>
          <ul>
            <li>每 30 分钟悄悄确认一次登录还有效；快过期时会在后台自动续上（用你学校的「记住我」），每天中午再刷新一次。</li>
            <li>只有自动续不上时才会通知你，去 <Link to="/settings">设置</Link> 点「重新登录」就行。期间截止日期由日历订阅兜底，不会漏掉。</li>
            <li>Course Hub 只读取 Canvas，从不提交、修改任何东西；不需要也不保存你的密码。</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>什么时候会通知你</h2></div>
        <div className="card card-pad prose">
          <ul>
            <li>没交的作业：截止前 24 小时和 3 小时各一次（时间可以在设置里改）。同一时间截止的好几项会合成一条。</li>
            <li>考试：同样提前提醒；只知道日期、不知道几点的考试，前一天晚上 6 点后提醒「明天考试」。</li>
            <li>同步后马上提醒：截止时间被提前、48 小时内截止的新作业、新公告。</li>
            <li>每天 7:00 日报，周日 20:00 周报。电脑当时在睡觉的话，醒来后补发。</li>
            <li>所有通知都存在 <Link to="/notices">通知记录</Link> 里，错过了可以补看。</li>
          </ul>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>常见问题</h2></div>
        <div className="stack">
          <Q q="我在 Canvas 交了，这里还显示没交？">点左下角「立即同步」，一两分钟后就会更新。平时每 2 小时（早 7 点到半夜）自动同步一次。</Q>
          <Q q="某门课的作业不见了？">去 <Link to="/settings">设置</Link> 看那门课是不是被隐藏了；或者学校登录过期了（左下角会显示「需登录」）。</Q>
          <Q q="学习讲解准不准？">讲解只根据这门课的课件、页面和作业要求来写，每个概念都标了出处（课件第几页），可以点过去对照。资料没讲到的背景知识会标「（补充）」。日期一律来自 Canvas，AI 不写日期。</Q>
          <Q q="AI 会额外花钱吗？">不会。用的是你自己的 Claude 订阅（claude 命令），不走按量计费的 API。可以在设置里关掉 AI，日报周报照常生成，只是没有 AI 安排。</Q>
          <Q q="电脑关机或睡眠了怎么办？">醒来后错过的同步、日报、提醒都会补上一次。Course Hub 开机自动启动，出错会自动重启。</Q>
          <Q q="数据存在哪？会丢吗？">都在这台 Mac 的 ~/CourseHub/data 里，只有本机能打开。数据库每天自动备份（保留 14 天），坏了会自动恢复。课程文件不保存，都是链接到 Canvas。</Q>
          <Q q="哪里能看出系统有没有问题？">左下角「<Link to="/status">系统状态</Link>」，有问题会亮红点，并且告诉你点哪里修。</Q>
        </div>
      </section>
    </div>
  );
}
