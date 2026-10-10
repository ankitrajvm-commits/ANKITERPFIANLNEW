import cv2

path = r"C:\Users\rolln\Downloads\erpnext copy\SantuHardwareApp\Screen Recording 2026-10-09 at 6.45.15 PM.mov"
cap = cv2.VideoCapture(path)
fps = cap.get(cv2.CAP_PROP_FPS)
frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
duration = frame_count / fps if fps else 0
print(f"fps={fps} frames={frame_count} size={width}x{height} duration={duration:.1f}s")
