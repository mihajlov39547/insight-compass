
CREATE POLICY "Plant id temp: owner read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'plant-identification-temp' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Plant id temp: owner insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plant-identification-temp' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Plant id temp: owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'plant-identification-temp' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Plant id temp: owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plant-identification-temp' AND (storage.foldername(name))[1] = auth.uid()::text);
