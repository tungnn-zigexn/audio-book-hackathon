# Audio Book App (Expo + SQLite)

Ứng dụng nghe sách nói hỗ trợ giải mã ePub sang SQLite để tối ưu hiệu năng.

## Tính năng chính
- Giải mã ePub thông minh, loại bỏ rác metadata.
- Cơ sở dữ liệu SQLite bền vững.
- Hỗ trợ nạp Database tạo sẵn (Pre-built) để app khởi động tức thì.
- Lưu tiến trình đọc (Chapter progress).
- Chế độ đọc TTS (Text-to-Speech) đa ngôn ngữ.

## Quy trình xử lý Database (Offline Generator)
Để tối ưu tốc độ, ứng dụng sử dụng file DB được tạo sẵn.

### Cách cập nhật Database khi thêm sách mới:
1. Thêm file `.epub` vào thư mục `assets/epub`.
2. Chạy lệnh sau trong terminal:
```bash
npm run generate-db
```
3. Script sẽ tự động đọc ePub, lọc nội dung và tạo file `assets/audiobook-prebuilt.db`.

## Cấu trúc dự án
- `scripts/`: Chứa script tạo DB offline.
- `src/services/`: Các dịch vụ xử lý Audio, Database, ePub.
- `src/screens/`: Giao diện Thư viện và Trình phát nhạc.
- `assets/`: Chứa file ePub gốc và file DB pre-built.

## Cài đặt và Chạy
```bash
npm install
npm start
```
