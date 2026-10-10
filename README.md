# 🎙️ WhatsApp Voice Bot (Gemini TTS) — sirf apni "You" chat se control

Ye bot aapke WhatsApp se **pairing code** se judta hai aur Gemini ki free API se text ko **voice note** me badalta hai.

- Control sirf aapki **apni "You" (Message yourself) chat** se hota hai, aur **sirf `$` se shuru** hone wale messages pe.
- Normal messages, doosron ki chats, groups — bot **kuch nahi karta**.
- Voice badalna, speed, style, status — sab WhatsApp se. **Render me dobara jaane ki zaroorat nahi.**
- Default voice: **Kore**. Total **30 voices**.

---

## 📲 Kaise use karte hain (deploy ke baad)

Apni **"You"** chat kholo (WhatsApp → New chat → apna naam "(You)") aur likho:

| Aap likho | Kya hoga |
|---|---|
| `$ namaste dost kaise ho` | Text voice note ban jayega (default voice Kore) |
| `$ puck: namaste dost` | Sirf is baar Puck ki awaaz (naam ya number 1-30) |
| `$ 6: namaste` | Sirf is baar 6 number wali voice |
| *kisi message ko reply karke sirf* `$` | Wo message bol dega |
| `$voice` | 30 voices ki list (number ke saath) |
| `$voice 2` ya `$voice puck` | Default voice badal jayegi |
| `$command` | Saare commands ki list |

Normal note jaise `hello` ya `$100 diye` — **ignore** hota hai. Sirf `$` ke baad **space** (ya command ka naam) ho tabhi bot kaam karta hai.

### Saare 16 commands

| Command | Kaam |
|---|---|
| `$ <text>` (ya `$say <text>`) | Text ko voice note me badlo |
| `$ <voice>: <text>` | Ek baar ke liye alag voice (naam ya 1-30) |
| `$to <number> <text>` | Kisi aur ko voice note bhejo. Number country code ke saath, `+` ke bina: `$to 919876543210 namaste` |
| `$voice` | 30 voices ki list |
| `$voice <naam/number>` | Default voice badlo |
| `$sample [naam/number]` | Voice ka demo suno |
| `$speed <0.5-2>` | Bolne ki speed (jaise `$speed 1.2`) |
| `$style <instruction>` / `$style off` | Andaaz, jaise `$style Say warmly and slowly` |
| `$mode ptt` / `$mode file` | Voice note ya audio file ke roop me bhejo |
| `$model [naam]` | TTS model dekho / badlo |
| `$reset` | Saari settings default (voice Kore, speed 1x) |
| `$on` / `$off` | Bot chalu / band (band me sirf `$on`, `$status`, `$command`, `$ping` chalte hain) |
| `$status` | Voice, speed, model, aaj ke conversions, uptime |
| `$history` | Last 10 conversions |
| `$ping` | Bot zinda hai ya nahi |
| `$restart` | Bot restart (Render khud wapas chalu kar deta hai) |
| `$command` | Ye list (aliases: `$help`, `$menu`) |

> Settings (voice, speed, style, model, mode, on/off) **save rehti hain**, restart ke baad bhi.

### 30 Voices

| # | Naam | Andaaz | # | Naam | Andaaz | # | Naam | Andaaz |
|---|---|---|---|---|---|---|---|---|
| 1 | Zephyr | Bright | 11 | Enceladus | Breathy | 21 | Alnilam | Firm |
| 2 | Puck | Upbeat | 12 | Iapetus | Clear | 22 | Schedar | Even |
| 3 | Charon | Informative | 13 | Umbriel | Easy-going | 23 | Gacrux | Mature |
| 4 | **Kore** (default) | Firm | 14 | Algieba | Smooth | 24 | Pulcherrima | Forward |
| 5 | Fenrir | Excitable | 15 | Despina | Smooth | 25 | Achird | Friendly |
| 6 | Leda | Youthful | 16 | Erinome | Clear | 26 | Zubenelgenubi | Casual |
| 7 | Orus | Firm | 17 | Algenib | Gravelly | 27 | Vindemiatrix | Gentle |
| 8 | Aoede | Breezy | 18 | Rasalgethi | Informative | 28 | Sadachbia | Lively |
| 9 | Callirrhoe | Easy-going | 19 | Laomedeia | Upbeat | 29 | Sadaltager | Knowledgeable |
| 10 | Autonoe | Bright | 20 | Achernar | Soft | 30 | Sulafat | Warm |

---

## 🧰 Pehle ye 4 cheezein chahiye (sab free)

1. **GitHub account** (code rakhne ke liye)
2. **Render account** → https://render.com (deploy ke liye)
3. **Gemini API key** → https://aistudio.google.com/apikey → *Create API key* → copy karo
4. **MongoDB Atlas free account** → https://www.mongodb.com/cloud/atlas (session save karne ke liye)

> **MongoDB kyun?** Render ke free plan me disk temporary hoti hai. Restart/deploy pe session ud jata hai aur har baar dobara pairing code daalna padta. MongoDB me session save hota hai, to pairing **sirf ek baar** karni padti hai.

---

## 🚀 Step 1: GitHub repo banao

1. Phone ke browser (Chrome) me https://github.com/new kholo. Zaroorat ho to browser menu se **Desktop site** on karo.
2. Repository name: `wa-voice-bot` → **Private** rakho (zaroori nahi, par behtar) → **Create repository**.
3. Naye repo me **"uploading an existing file"** link pe tap karo.
4. Ye saari files upload karo (sab **same level pe**, kisi folder ke andar nahi):
   - `index.js`
   - `package.json`
   - `README.md`
   - `render.yaml` (optional, na daalo to bhi chalega)
5. **Commit changes** dabao.

⚠️ Files alag alag upload karo (koi folder ya zip nahi).

---

## 🍃 Step 2: MongoDB Atlas (free) setup

1. Atlas me sign up karo → **Create** → **M0 (Free)** cluster chuno → region koi bhi (Mumbai/Singapore) → Create.
2. **Database Access** → *Add New Database User* → username aur password daalo. Password me `@ : / ?` jaise special characters mat rakho (sirf letters + numbers). Password likh lo.
3. **Network Access** → *Add IP Address* → **Allow access from anywhere** (`0.0.0.0/0`) → Confirm. (Render ka IP badalta rehta hai, isliye ye zaroori hai.)
4. **Database** → apne cluster pe **Connect** → **Drivers** → connection string copy karo. Aisi dikhegi:
   ```
   mongodb+srv://USER:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. `<password>` ki jagah apna password likho (`<` `>` hata do). Ye hi aapka **`MONGODB_URI`** hai.

---

## ☁️ Step 3: Render pe deploy

1. https://dashboard.render.com → **New +** → **Web Service**.
2. **Build and deploy from a Git repository** → GitHub connect karo → `wa-voice-bot` repo chuno.
3. Settings:
   - **Name:** `wa-voice-bot` (ya kuch bhi)
   - **Region:** Singapore (India ke paas)
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Environment Variables** me ye add karo:

| Key | Value |
|---|---|
| `PAIRING_NUMBER` | Aapka WhatsApp number country code ke saath, bina `+` aur space ke. Jaise `919876543210` |
| `GEMINI_API_KEY` | Step "Pehle ye 4 cheezein" wali Gemini key |
| `MONGODB_URI` | MongoDB wali connection string |
| `ADMIN_KEY` | Koi bhi password (jaise `mera123pass`). Isse pairing page lock rehta hai |
| `NODE_VERSION` | `22` |

5. **Create Web Service** dabao. Build me 2-5 minute lagte hain. Jab "Live" dikhe to aage badho.

---

## 🔑 Step 4: WhatsApp se connect (pairing code)

1. Render me apne service ka URL dekho, jaise `https://wa-voice-bot.onrender.com`.
2. Browser me kholo (apna `ADMIN_KEY` lagake):
   ```
   https://wa-voice-bot.onrender.com/?key=mera123pass
   ```
   Wahan 8 characters ka **pairing code** dikhega (jaise `ABCD-1234`). Code Render ke **Logs** me bhi aata hai.
3. Phone me WhatsApp kholo → **Settings → Linked devices → Link a device**.
4. Neeche **"Link with phone number instead"** pe tap karo → code daalo.
5. Connect hote hi bot aapki **"You" chat** me message bhejega: *"Voice bot connected!"*
6. Ab "You" chat me test karo: `$ namaste dost`

Code ~1 min me khud badal jata hai. Page ko refresh hote raho, naya code dikhega.

---

## ⏰ Step 5: Bot ko 24 ghante jaaga rakho (zaroori)

Render free plan **15 min tak koi visit na aaye to service so jati hai**, aur bot WhatsApp se disconnect ho jata hai. Free fix:

1. https://uptimerobot.com pe free account banao.
2. **Add New Monitor** → type **HTTP(s)**.
3. URL: `https://wa-voice-bot.onrender.com/health`
4. Interval: **5 minutes** → Create.

(Bot me ek self-ping bhi hai, par UptimeRobot zyada bharosemand hai. Dono rakho.)

Render free plan me mahine ke ~750 free hours milte hain, ek hi service 24x7 chalane ke liye kaafi hain.

---

## ⚙️ Environment variables (poori list)

| Variable | Zaroori? | Matlab |
|---|---|---|
| `PAIRING_NUMBER` | ✅ | WhatsApp number, country code ke saath, sirf digits |
| `GEMINI_API_KEY` | ✅ | Gemini key. Kai keys: `key1,key2` (limit lagne pe agli key try hoti hai) |
| `MONGODB_URI` | Free Render pe ✅ | Session + settings save karne ke liye |
| `ADMIN_KEY` | Optional | Pairing page ka password (`/?key=...`) |
| `NODE_VERSION` | Render pe | `22` |
| `TTS_MODEL` | Optional | Default `gemini-2.5-flash-preview-tts`. WhatsApp se bhi badal sakte ho: `$model <naam>` |
| `MAX_CHARS` | Optional | Ek baar me max characters (default 4000) |
| `MAX_AGE_SEC` | Optional | Itne second se purane `$` messages ignore (default 180) |
| `TZ_NAME` | Optional | Time zone (default `Asia/Kolkata`) |
| `DATA_DIR` | Optional | MongoDB ke bina file storage ka folder (Render paid disk: `/var/data`) |
| `MONGODB_DB` | Optional | Database ka naam (default `wa_voice_bot`) |
| `SELF_PING` | Optional | `false` karo to self-ping band |
| `BAILEYS_LOG` | Optional | Debug ke liye `debug` |

### MongoDB ke bina chalana
`MONGODB_URI` mat daalo. Tab session `./data` folder me save hota hai.
- **Render free:** har restart/deploy pe session ud jayega → pairing code dobara daalna padega.
- **Render paid + Disk:** Disk attach karo (mount path `/var/data`) aur `DATA_DIR=/var/data` set karo.

---

## 🛠️ Problems aur unke solution

| Problem | Solution |
|---|---|
| "You" chat me `$` likha, kuch nahi hua | Sirf apni **khud ki chat** (You / Message yourself) me kaam karta hai. `$` ke baad **space** do (`$ hello`). Bot connected hai ya nahi: Render URL kholo. `$ping` bhi try karo |
| Bot offline ho jata hai | UptimeRobot (Step 5) lagao. Render Logs me `WhatsApp closed` dekho |
| Har restart pe dobara pairing | `MONGODB_URI` set nahi hai ya galat hai. Page par error dikhega |
| "Storage start nahi hua" | MongoDB ka password, connection string aur Network Access (`0.0.0.0/0`) check karo |
| `Gemini free limit/rate limit (429)` | Free API ki limit khatam. Thodi der ruko, ya doosri key `key1,key2` me jodo |
| `Model ... nahi chal raha` (404) | Google TTS model ka naam badalta rehta hai. AI Studio me current TTS model ka naam dekho aur `$model <naam>` likho. Bot kuch backup models khud bhi try karta hai |
| `ffmpeg nahi chala` | `package.json` me `ffmpeg-static` hona chahiye. Render pe dobara **Manual Deploy → Clear build cache & deploy** |
| `Connection replaced` | Wahi session do jagah chal raha hai (laptop + Render, ya deploy ke dauran 2 copies). Ek band karo, bot 30 sec me khud theek ho jata hai |
| Voice note ki jagah file aa rahi hai | `$mode ptt` likho |
| Code "invalid" bol raha hai | Naya code lo (1 min me badalta hai). `PAIRING_NUMBER` me country code hona chahiye |
| Bot ko dobara naye number se jodna hai | Phone ke Linked devices me bot ka device Log out karo. Bot khud naya pairing code bana dega |

---

## ⚠️ Zaroori baatein

- Ye **unofficial** WhatsApp library (Baileys) use karta hai. Is tarah ke bots se kabhi kabhi **account ban ka risk** hota hai. Isliye spam mat karo aur `$to` se bahut zyada messages mat bhejo. Chaho to alag (secondary) number use karo.
- Free Gemini tier me Google aapka text apne products behtar karne ke liye use kar sakta hai. Private ya sensitive text mat bhejo. Free limits aur terms badalte rehte hain, AI Studio me dekh lo.
- Apni `GEMINI_API_KEY` aur `MONGODB_URI` kabhi GitHub me mat daalo. Sirf Render ke Environment Variables me rakho.
- Bot sirf aapki **apni chat** ke `$` messages sunta hai. Phir bhi `ADMIN_KEY` set rakho taaki pairing page koi aur na dekh sake.

---

## 📁 Files

| File | Kaam |
|---|---|
| `index.js` | Poora bot ek hi file me (WhatsApp connect, Gemini TTS, voices, commands, web page) |
| `package.json` | Dependencies |
| `render.yaml` | Optional Render blueprint |
| `README.md` | Ye guide |
