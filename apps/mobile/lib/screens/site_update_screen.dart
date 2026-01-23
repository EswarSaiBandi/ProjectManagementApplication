import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:record/record.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'dart:io';

class SiteUpdateScreen extends StatefulWidget {
  const SiteUpdateScreen({super.key});

  @override
  State<SiteUpdateScreen> createState() => _SiteUpdateScreenState();
}

class _SiteUpdateScreenState extends State<SiteUpdateScreen> {
  bool _isRecording = false;
  bool _isUploading = false;
  File? _photo;
  final ImagePicker _picker = ImagePicker();
  late final AudioRecorder _audioRecorder;

  @override
  void initState() {
    super.initState();
    _audioRecorder = AudioRecorder();
  }

  @override
  void dispose() {
    _audioRecorder.dispose();
    super.dispose();
  }

  /// Uploads a file to Supabase Storage and returns the public URL
  Future<String?> _uploadFile(File file, String bucketName) async {
    try {
      setState(() => _isUploading = true);
      
      final String extension = file.path.split('.').last;
      // Unique filename: timestamp_random.ext
      final String fileName = '${DateTime.now().millisecondsSinceEpoch}.$extension';
      
      await Supabase.instance.client.storage
          .from(bucketName)
          .upload(fileName, file);

      final String publicUrl = Supabase.instance.client.storage
          .from(bucketName)
          .getPublicUrl(fileName);

      print('✅ Uploaded to $bucketName: $publicUrl');
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Uploaded to $bucketName: $publicUrl')),
      );
      
      return publicUrl;
    } catch (e) {
      print('❌ Upload Error: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Upload Failed: $e'), backgroundColor: Colors.red),
      );
      return null;
    } finally {
      setState(() => _isUploading = false);
    }
  }

  Future<void> _pickImage() async {
    // Request Camera Permission
    var status = await Permission.camera.request();
    if (status.isDenied) return;

    final XFile? image = await _picker.pickImage(source: ImageSource.camera);
    if (image != null) {
      setState(() {
        _photo = File(image.path);
      });
      // Auto-upload
      await _uploadFile(_photo!, 'site-evidence');
    }
  }

  Future<void> _startRecording() async {
    // Request Microphone Permission
    var status = await Permission.microphone.request();
    if (status.isDenied) return;

    if (await _audioRecorder.hasPermission()) {
      final Directory appDir = await getApplicationDocumentsDirectory();
      final String filePath = '${appDir.path}/temp_audio.m4a';
      
      // Start recording
      await _audioRecorder.start(const RecordConfig(), path: filePath);
      
      setState(() => _isRecording = true);
    }
  }

  Future<void> _stopRecording() async {
    if (!_isRecording) return;
    
    // Stop recording and get path
    final String? path = await _audioRecorder.stop();
    setState(() => _isRecording = false);

    if (path != null) {
      // Auto-upload
      await _uploadFile(File(path), 'audio-logs');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Site Update')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Activity: Demolition',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const Spacer(),
            
            // Mic Button
            Center(
              child: GestureDetector(
                onLongPressStart: (_) => _startRecording(),
                onLongPressEnd: (_) => _stopRecording(),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  width: _isRecording ? 150 : 120,
                  height: _isRecording ? 150 : 120,
                  decoration: BoxDecoration(
                    color: _isRecording ? Colors.red : Colors.blue,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: (_isRecording ? Colors.red : Colors.blue).withOpacity(0.4),
                        blurRadius: 20,
                        spreadRadius: 5,
                      )
                    ],
                  ),
                  child: Icon(
                    Icons.mic,
                    color: Colors.white,
                    size: _isRecording ? 60 : 50,
                  ),
                ),
              ),
            ),
            if (_isRecording)
              const Padding(
                padding: EdgeInsets.only(top: 16),
                child: Text('Recording...', textAlign: TextAlign.center, style: TextStyle(color: Colors.red)),
              ),
              
            const Spacer(),
            
            // Progress Indicator
            if (_isUploading)
              const Padding(
                padding: EdgeInsets.all(8.0),
                child: Center(child: CircularProgressIndicator()),
              ),

            // Photo Section
            if (_photo != null)
              Container(
                height: 100,
                margin: const EdgeInsets.only(bottom: 16),
                child: Image.file(_photo!),
              ),
            ElevatedButton.icon(
              onPressed: _isUploading ? null : _pickImage,
              icon: const Icon(Icons.camera_alt),
              label: const Text('Add Photo'),
            ),
            
            const SizedBox(height: 16),
            
            // Submit Button
            SizedBox(
              height: 50,
              child: ElevatedButton(
                onPressed: () {
                  // Final submission logic could go here
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Update Saved Locally')),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.green,
                  foregroundColor: Colors.white,
                ),
                child: const Text('Save Update', style: TextStyle(fontSize: 18)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
